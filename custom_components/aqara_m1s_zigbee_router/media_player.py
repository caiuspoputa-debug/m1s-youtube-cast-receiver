from __future__ import annotations

import asyncio
from array import array
import logging
import os
import shutil
import socket
import sys
import time
from urllib.parse import urlsplit, urlunsplit
from contextlib import suppress
from typing import Any

from homeassistant.components import media_source
from homeassistant.components.media_player import (
    MediaPlayerDeviceClass,
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
    MediaType,
)
from homeassistant.components.media_player.browse_media import (
    async_process_play_media_url,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .client import AqaraM1SClient
from .media_group import AqaraM1SMediaGroup
from .const import (
    DATA_CLIENTS,
    DATA_COORDINATORS,
    DATA_RADIO_PLAYERS,
    DATA_MEDIA_GROUP,
    DOMAIN,
    radio_volume_signal,
)

_LOGGER = logging.getLogger(__name__)

RADIO_PORT = 12346
REMOTE_FIFO = "/tmp/aqara_m1s_radio_fifo"
REMOTE_NC_PID = "/tmp/aqara_m1s_radio_nc.pid"
REMOTE_APLAY_PID = "/tmp/aqara_m1s_radio_aplay.pid"

WATCHDOG_RESTART_DELAY = 5.0
WATCHDOG_MAX_RESTARTS = 3
WATCHDOG_STABLE_SECONDS = 30.0
WATCHDOG_SLOW_RETRY_DELAY = 60.0

PCM_RATE = 32000
PCM_CHANNELS = 1
PCM_SAMPLE_BYTES = 4
PCM_CHUNK_SECONDS = 0.02
PCM_CHUNK_BYTES = int(
    PCM_RATE * PCM_CHANNELS * PCM_SAMPLE_BYTES * PCM_CHUNK_SECONDS
)
PCM_SILENCE_CHUNK = b"\x00" * PCM_CHUNK_BYTES
GAIN_RAMP_SECONDS = 0.04
GAIN_RAMP_SAMPLES = max(1, int(PCM_RATE * GAIN_RAMP_SECONDS))
WRITER_DRAIN_TIMEOUT = 2.0
FFMPEG_NICE_TARGET = -5
APLAY_NICE_TARGET = -3

REMOTE_STOP_COMMAND = (
    # First stop the exact PIDs recorded when this integration started the
    # receiver. PID files can be stale after a hub reboot, so this is followed
    # by command-line scoped fallbacks. Never use killall: the hub may run
    # unrelated nc/aplay processes.
    f'for f in {REMOTE_NC_PID} {REMOTE_APLAY_PID}; do '
    '[ -f "$f" ] && kill -9 "$(cat "$f")" 2>/dev/null; '
    'done; '
    f'for p in $(ps w | grep "[n]c -l -p {RADIO_PORT}" | awk '"'"'{print $1}'"'"'); do '
    'kill -9 "$p" 2>/dev/null; done; '
    f'for p in $(ps w | grep "[a]play .*{REMOTE_FIFO}" | awk '"'"'{print $1}'"'"'); do '
    'kill -9 "$p" 2>/dev/null; done; '
    f'rm -f {REMOTE_NC_PID} {REMOTE_APLAY_PID} {REMOTE_FIFO}'
)

REMOTE_START_COMMAND = (
    REMOTE_STOP_COMMAND
    + f'; mkfifo {REMOTE_FIFO}; '
    + f'nc -l -p {RADIO_PORT} </dev/null > {REMOTE_FIFO} '
      '2>/tmp/aqara_m1s_radio_nc.log & '
    + f'echo $! > {REMOTE_NC_PID}; '
    + f'aplay -t raw -f S32_LE -c 1 -r {PCM_RATE} '
      f'{REMOTE_FIFO} </dev/null '
      '>/tmp/aqara_m1s_radio_aplay.log 2>&1 & '
    + f'echo $! > {REMOTE_APLAY_PID}; '
    + f'APID=$(cat {REMOTE_APLAY_PID}); '
      f'renice {APLAY_NICE_TARGET} -p "$APID" '
      '>/tmp/aqara_m1s_radio_aplay_renice.log 2>&1 || true'
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    player = hass.data[DOMAIN][DATA_RADIO_PLAYERS][entry.entry_id]
    entities: list[MediaPlayerEntity] = [player]
    manager = hass.data[DOMAIN][DATA_MEDIA_GROUP]
    if not manager.media_entity_added:
        manager.media_entity_added = True
        entities.append(AqaraM1SMediaGroup(hass, manager))
    async_add_entities(entities)


class AqaraM1SRadioPlayer(CoordinatorEntity, MediaPlayerEntity, RestoreEntity):
    """Stream Home Assistant media to the Aqara M1S speaker."""

    _attr_name = "Media Player"
    _attr_device_class = MediaPlayerDeviceClass.SPEAKER
    _attr_should_poll = False
    # Main native Home Assistant slider: 0-100% in uniform 0.1% steps.
    # v0.5.9 adds a separate per-player Fine Volume Trim Number entity
    # (-1.00..+1.00 percentage points in 0.01 steps) without changing this
    # convenient coarse/main control.
    _attr_volume_step = 0.001
    _attr_supported_features = (
        MediaPlayerEntityFeature.BROWSE_MEDIA
        | MediaPlayerEntityFeature.PLAY_MEDIA
        | MediaPlayerEntityFeature.STOP
        | MediaPlayerEntityFeature.PLAY
        | MediaPlayerEntityFeature.VOLUME_SET
        | MediaPlayerEntityFeature.VOLUME_STEP
        | MediaPlayerEntityFeature.VOLUME_MUTE
        | MediaPlayerEntityFeature.TURN_OFF
    )

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: AqaraM1SClient,
        coordinator,
    ) -> None:
        super().__init__(coordinator)
        self.hass = hass
        self.entry = entry
        self.client = client
        self._attr_unique_id = f"{entry.entry_id}_radio"
        self._attr_state = MediaPlayerState.IDLE
        self._attr_volume_level = 0.05
        self._attr_is_volume_muted = False
        # Absolute percentage-point trim applied after the main volume.
        # Example: 6.0% main + 0.27% trim = 6.27% effective gain.
        self._fine_volume_trim_percent = 0.0
        self._attr_media_content_type = MediaType.MUSIC
        self._attr_media_title = None
        self._media_url: str | None = None
        self._resume_media_id: str | None = None
        self._resume_media_type: str = MediaType.MUSIC
        self._resume_after_reconnect = False
        self._last_online_generation = 0
        self._resume_task: asyncio.Task | None = None
        self._ffmpeg: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._watch_task: asyncio.Task | None = None
        self._stream_writer: asyncio.StreamWriter | None = None
        self._ffmpeg_nice_applied = False
        self._gain_current = self._effective_gain()
        self._gain_target = self._gain_current
        self._gain_ramp_start = self._gain_current
        self._gain_ramp_remaining = 0
        self._watchdog_restart_task: asyncio.Task | None = None
        self._watchdog_stable_task: asyncio.Task | None = None
        self._watchdog_slow_retry_task: asyncio.Task | None = None
        self._watchdog_restart_attempts = 0
        self._ffmpeg_started_monotonic: float | None = None
        self._ffmpeg_session = 0
        self._last_failure_kind: str | None = None
        self._last_failure_detail: str | None = None
        self._recovery_pending = False
        self._shutting_down = False
        self._group_manager = None
        self._attr_device_info = {
            "identifiers": {(DOMAIN, client.host)},
            "name": entry.data.get("name", f"Aqara M1S {client.host}"),
            "manufacturer": "Aqara",
            "model": "M1S Gen 1 / JN5189 Router",
        }

    def set_group_manager(self, manager) -> None:
        """Attach the shared group arbiter without changing individual behavior."""
        self._group_manager = manager

    @property
    def playback_requested(self) -> bool:
        return bool(self._resume_after_reconnect)

    async def _claim_individual_audio(self) -> None:
        if self._group_manager is not None:
            await self._group_manager.async_claim_individual(self.entry.entry_id)

    async def _release_individual_audio(self) -> None:
        if self._group_manager is not None:
            await self._group_manager.async_release_individual(self.entry.entry_id)

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()

        last_state = await self.async_get_last_state()
        if last_state is not None:
            attrs = last_state.attributes

            restored_volume = attrs.get("volume_level")
            if restored_volume is not None:
                try:
                    self._attr_volume_level = self._normalize_volume(
                        float(restored_volume)
                    )
                except (TypeError, ValueError):
                    pass

            self._attr_is_volume_muted = bool(
                attrs.get("is_volume_muted", False)
            )
            self._resume_media_id = (
                attrs.get("last_media_id") or attrs.get("media_content_id")
            )
            self._resume_media_type = (
                attrs.get("last_media_type")
                or attrs.get("media_content_type")
                or MediaType.MUSIC
            )
            self._attr_media_content_id = self._resume_media_id
            self._attr_media_content_type = self._resume_media_type
            self._attr_media_title = (
                attrs.get("last_media_title") or attrs.get("media_title")
            )
            self._resume_after_reconnect = bool(
                attrs.get("resume_after_reconnect", last_state.state == MediaPlayerState.PLAYING)
            )

            # Direct URLs can be prepared immediately. Media-source IDs are
            # resolved freshly only when PLAY is pressed, because their resolved
            # URLs may contain temporary authentication data.
            if self._resume_media_id and not media_source.is_media_source_id(
                self._resume_media_id
            ):
                self._media_url = async_process_play_media_url(
                    self.hass,
                    self._resume_media_id,
                    allow_relative_url=False,
                )

            self._attr_state = MediaPlayerState.IDLE

        if self._group_manager is not None:
            self._group_manager.mark_individual_intent(
                self.entry.entry_id, self._resume_after_reconnect
            )

        data = self.coordinator.data or {}
        self._last_online_generation = int(data.get("online_generation", 0) or 0)
        if self._resume_after_reconnect and self._resume_media_id:
            self._schedule_resume(delay=2.0)

        async_dispatcher_send(
            self.hass, radio_volume_signal(self.entry.entry_id)
        )

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Persist the last playable media and the radio volume."""
        return {
            "last_media_id": self._resume_media_id,
            "last_media_type": self._resume_media_type,
            "last_media_title": self._attr_media_title,
            "volume_level": self._attr_volume_level,
            "fine_volume_trim_percent": round(self._fine_volume_trim_percent, 2),
            "effective_volume_percent": round(self._effective_gain() * 100.0, 2),
            "is_volume_muted": self._attr_is_volume_muted,
            "resume_after_reconnect": self._resume_after_reconnect,
            "watchdog_restart_attempts": self._watchdog_restart_attempts,
            "last_failure_kind": self._last_failure_kind,
            "last_failure_detail": self._last_failure_detail,
            "volume_apply_mode": "live_pcm_software_gain",
            "volume_stream_restart": False,
            "volume_step_percent": 0.1,
            "gain_ramp_ms": int(GAIN_RAMP_SECONDS * 1000),
            "pcm_writer_timeout_seconds": WRITER_DRAIN_TIMEOUT,
            "ffmpeg_nice_target": FFMPEG_NICE_TARGET,
            "ffmpeg_nice_applied": self._ffmpeg_nice_applied,
            "aplay_nice_target": APLAY_NICE_TARGET,
        }

    async def async_will_remove_from_hass(self) -> None:
        """Stop background work cleanly before the entity is removed."""
        await self.async_shutdown()
        await super().async_will_remove_from_hass()

    async def _cancel_task(self, task: asyncio.Task | None) -> None:
        """Cancel and await a task so it cannot leak into HA shutdown/startup."""
        if task is None or task is asyncio.current_task():
            return
        if not task.done():
            task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def async_shutdown(self) -> None:
        """Stop FFmpeg and every watchdog task without clearing resume intent."""
        if self._shutting_down:
            return
        self._shutting_down = True

        tasks = [
            self._resume_task,
            self._watchdog_restart_task,
            self._watchdog_stable_task,
            self._watchdog_slow_retry_task,
        ]
        self._resume_task = None
        self._watchdog_restart_task = None
        self._watchdog_stable_task = None
        self._watchdog_slow_retry_task = None
        for task in tasks:
            await self._cancel_task(task)

        async with self._lock:
            await self._stop_locked(
                update_state=False, reason="integration_shutdown"
            )

    async def async_browse_media(
        self,
        media_content_type: str | None = None,
        media_content_id: str | None = None,
    ):
        """Expose Home Assistant audio sources in the native media browser."""
        return await media_source.async_browse_media(
            self.hass,
            media_content_id,
            content_filter=lambda item: item.media_content_type.startswith("audio/"),
        )

    async def async_play_media(
        self,
        media_type: str,
        media_id: str,
        **kwargs: Any,
    ) -> None:
        """Resolve a HA media source, remember it, and stream it to the hub."""
        original_media_id = media_id
        resolved_media_id = media_id

        if media_source.is_media_source_id(media_id):
            resolved = await media_source.async_resolve_media(
                self.hass,
                media_id,
                self.entity_id,
            )
            resolved_media_id = resolved.url

        media_url = async_process_play_media_url(
            self.hass,
            resolved_media_id,
            allow_relative_url=False,
        )

        title = None
        extra = kwargs.get("extra") or {}
        if isinstance(extra, dict):
            title = extra.get("title")

        async with self._lock:
            self._resume_media_id = original_media_id
            self._resume_media_type = media_type or MediaType.MUSIC
            self._media_url = media_url
            self._attr_media_content_id = original_media_id
            self._attr_media_content_type = self._resume_media_type
            self._attr_media_title = title or self._attr_media_title or "Radio stream"
            self._resume_after_reconnect = True
            await self._start_locked()

    async def async_media_play(self) -> None:
        """Resume the last remembered media."""
        if self._shutting_down:
            return
        self._resume_after_reconnect = True
        if not self._resume_media_id and not self._media_url:
            return

        if self._resume_media_id and media_source.is_media_source_id(
            self._resume_media_id
        ):
            resolved = await media_source.async_resolve_media(
                self.hass,
                self._resume_media_id,
                self.entity_id,
            )
            media_url = async_process_play_media_url(
                self.hass,
                resolved.url,
                allow_relative_url=False,
            )
            async with self._lock:
                self._media_url = media_url
                await self._start_locked()
            return

        async with self._lock:
            await self._start_locked()

    async def async_media_stop(self) -> None:
        self._resume_after_reconnect = False
        self._watchdog_restart_attempts = 0
        if self._watchdog_restart_task:
            self._watchdog_restart_task.cancel()
            self._watchdog_restart_task = None
        if self._watchdog_stable_task:
            self._watchdog_stable_task.cancel()
            self._watchdog_stable_task = None
        if self._watchdog_slow_retry_task:
            self._watchdog_slow_retry_task.cancel()
            self._watchdog_slow_retry_task = None
        if self._resume_task:
            self._resume_task.cancel()
            self._resume_task = None
        async with self._lock:
            await self._stop_locked(update_state=True, reason="user_stop")
        await self._release_individual_audio()

    async def async_turn_off(self) -> None:
        await self.async_media_stop()

    async def async_set_volume_level(self, volume: float) -> None:
        """Apply individual-player volume live to the running PCM stream."""
        self._attr_volume_level = self._normalize_volume(float(volume))
        self.async_write_ha_state()
        async_dispatcher_send(
            self.hass, radio_volume_signal(self.entry.entry_id)
        )

    @staticmethod
    def _normalize_volume(volume: float) -> float:
        """Quantize the complete 0-100% range in uniform 0.1% steps."""
        volume = max(0.0, min(1.0, volume))
        quantized = round(volume / 0.001) * 0.001
        return max(0.0, min(1.0, round(quantized, 3)))

    async def async_volume_up(self) -> None:
        """Increase volume by 0.1%."""
        current = self._attr_volume_level or 0.0
        await self.async_set_volume_level(current + 0.001)

    async def async_volume_down(self) -> None:
        """Decrease volume by 0.1%."""
        current = self._attr_volume_level or 0.0
        await self.async_set_volume_level(current - 0.001)

    async def async_mute_volume(self, mute: bool) -> None:
        """Apply mute live through the same PCM gain path."""
        self._attr_is_volume_muted = bool(mute)
        self.async_write_ha_state()
        async_dispatcher_send(
            self.hass, radio_volume_signal(self.entry.entry_id)
        )

    @property
    def fine_volume_trim_percent(self) -> float:
        """Return the per-player absolute fine trim in percentage points."""
        return self._fine_volume_trim_percent

    @staticmethod
    def _normalize_fine_volume_trim_percent(value: float) -> float:
        """Clamp/quantize fine trim to -1.00..+1.00 in 0.01% steps."""
        value = max(-1.0, min(1.0, float(value)))
        return round(round(value / 0.01) * 0.01, 2)

    def set_fine_volume_trim_percent(self, value: float) -> None:
        """Apply a fine absolute percentage-point trim to live PCM gain."""
        self._fine_volume_trim_percent = self._normalize_fine_volume_trim_percent(value)
        # _apply_live_pcm_gain() samples _effective_gain() for every 20 ms PCM
        # chunk, so no FFmpeg/TCP/aplay restart is needed. If the media-player
        # entity is already registered, refresh its diagnostic attributes too.
        if self.entity_id is not None:
            self.async_write_ha_state()

    def _effective_gain(self) -> float:
        if self._attr_is_volume_muted:
            return 0.0
        main_gain = max(0.0, min(1.0, float(self._attr_volume_level or 0.0)))
        # Volume 0 is a hard silence. A positive trim must never make a player
        # audible when the main Home Assistant volume is explicitly zero.
        if main_gain <= 0.0:
            return 0.0
        trimmed_gain = main_gain + (self._fine_volume_trim_percent / 100.0)
        return max(0.0, min(1.0, trimmed_gain))

    def _reset_live_gain(self) -> None:
        target = self._effective_gain()
        self._gain_current = target
        self._gain_target = target
        self._gain_ramp_start = target
        self._gain_ramp_remaining = 0

    def _apply_live_pcm_gain(self, chunk: bytes) -> bytes:
        """Scale one S32_LE PCM chunk with a short anti-click transition."""
        target = self._effective_gain()
        if target != self._gain_target:
            self._gain_ramp_start = self._gain_current
            self._gain_target = target
            self._gain_ramp_remaining = GAIN_RAMP_SAMPLES

        if self._gain_ramp_remaining <= 0:
            self._gain_current = target
            if target <= 0.0:
                return PCM_SILENCE_CHUNK
            if target >= 1.0:
                return chunk

        samples = array("i")
        samples.frombytes(chunk)
        if samples.itemsize != PCM_SAMPLE_BYTES:
            raise RuntimeError(
                f"Unsupported native int size for S32_LE PCM: {samples.itemsize}"
            )
        if sys.byteorder != "little":
            samples.byteswap()

        if self._gain_ramp_remaining > 0:
            start_gain = self._gain_ramp_start
            change = self._gain_target - start_gain
            remaining = self._gain_ramp_remaining
            total = GAIN_RAMP_SAMPLES
            elapsed = total - remaining
            for index, sample in enumerate(samples):
                if remaining > 0:
                    progress = min(1.0, (elapsed + index + 1) / total)
                    gain = start_gain + (change * progress)
                    remaining -= 1
                else:
                    gain = self._gain_target
                samples[index] = int(sample * gain)
            self._gain_ramp_remaining = remaining
            if remaining <= 0:
                self._gain_current = self._gain_target
            else:
                progress = min(1.0, (total - remaining) / total)
                self._gain_current = start_gain + (change * progress)
        else:
            gain = self._gain_current
            for index, sample in enumerate(samples):
                samples[index] = int(sample * gain)

        if sys.byteorder != "little":
            samples.byteswap()
        return samples.tobytes()

    def _handle_coordinator_update(self) -> None:
        """Resume the remembered media after a real hub reconnect."""
        data = self.coordinator.data or {}
        generation = int(data.get("online_generation", 0) or 0)
        if generation > self._last_online_generation:
            self._last_online_generation = generation
            # A genuine offline/online cycle starts a fresh recovery window.
            # Fast watchdog retries may have been exhausted while the hub was
            # unreachable; reconnect must still resume the remembered stream.
            self._watchdog_restart_attempts = 0
            if self._watchdog_slow_retry_task:
                self._watchdog_slow_retry_task.cancel()
                self._watchdog_slow_retry_task = None
            if self._resume_after_reconnect and self._resume_media_id:
                _LOGGER.info(
                    "Aqara media hub reconnected; scheduling remembered media resume "
                    "entity=%s host=%s",
                    self.entity_id,
                    self.client.host,
                )
                self._schedule_resume(delay=2.0)
        super()._handle_coordinator_update()

    def _schedule_resume(self, delay: float) -> None:
        if self._resume_task and not self._resume_task.done():
            return
        self._resume_task = self.hass.async_create_task(
            self._async_resume_after_delay(delay)
        )

    async def _async_resume_after_delay(self, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            if (
                self._resume_after_reconnect
                and self._resume_media_id
                and self.coordinator.last_update_success
                and self._attr_state != MediaPlayerState.PLAYING
            ):
                await self.async_media_play()
            # Very short source failures can finish while this retry task is
            # still active. Give the watcher a moment to classify the exit,
            # then explicitly queue the next attempt after releasing this task.
            await asyncio.sleep(0.5)
            if (
                self._resume_after_reconnect
                and self._attr_state != MediaPlayerState.PLAYING
                and self.coordinator.last_update_success
            ):
                next_kind = self._last_failure_kind or "unknown"
                self._watchdog_restart_task = None
                self._schedule_watchdog_restart(next_kind)
                return
        except asyncio.CancelledError:
            return
        except Exception as err:
            _LOGGER.warning("Could not automatically resume Aqara media: %s", err)
        finally:
            if self._resume_task is asyncio.current_task():
                self._resume_task = None

    @staticmethod
    def _safe_media_for_log(media_url: str | None) -> str:
        """Return a useful media identifier without query tokens or credentials."""
        if not media_url:
            return "<none>"
        try:
            parts = urlsplit(media_url)
            host = parts.hostname or ""
            if parts.port:
                host = f"{host}:{parts.port}"
            return urlunsplit((parts.scheme, host, parts.path, "", ""))
        except Exception:
            return "<unparseable>"

    @staticmethod
    def _classify_ffmpeg_failure(stderr_text: str, runtime: float) -> tuple[str, str]:
        """Classify an FFmpeg exit so recovery targets the real failure domain."""
        text = stderr_text.lower()
        source_patterns = (
            "error opening input",
            "error opening input file",
            "connection refused",
            "server returned 4",
            "server returned 5",
            "http error",
            "failed to resolve hostname",
            "temporary failure in name resolution",
            "name or service not known",
            "input/output error",
            "invalid data found when processing input",
            "end of file",
            "connection timed out",
        )
        output_patterns = (
            "broken pipe",
            "error muxing a packet",
            "error writing trailer",
            "error closing file",
            "connection reset by peer",
        )
        if runtime <= 10.0 and any(pattern in text for pattern in source_patterns):
            return "source_unavailable", "FFmpeg could not open or keep the media source"
        if any(pattern in text for pattern in output_patterns):
            return "hub_audio", "The hub-side TCP/audio receiver closed the output"
        return "unknown", "FFmpeg exited for an unclassified reason"

    async def _log_remote_audio_snapshot(self, session: int) -> None:
        """Capture a small hub-side snapshot after an unexpected FFmpeg exit."""
        command = (
            'echo "--- aplay ---"; ps w | grep "[a]play"; '
            'echo "--- nc ---"; ps w | grep "[n]c"; '
            f'echo "--- TCP {RADIO_PORT} ---"; netstat -an 2>/dev/null | grep {RADIO_PORT}; '
            'echo "--- memory ---"; free 2>/dev/null; '
            'echo "--- receiver logs ---"; '
            'tail -n 20 /tmp/aqara_m1s_radio_nc.log 2>/dev/null; '
            'tail -n 20 /tmp/aqara_m1s_radio_aplay.log 2>/dev/null'
        )
        try:
            snapshot = await self.hass.async_add_executor_job(
                self.client.run_command, command
            )
            _LOGGER.warning(
                "Aqara media diagnostic hub snapshot entity=%s session=%s host=%s\n%s",
                self.entity_id,
                session,
                self.client.host,
                snapshot[-6000:],
            )
        except Exception as err:
            _LOGGER.warning(
                "Aqara media diagnostic could not read hub snapshot "
                "entity=%s session=%s host=%s error=%s",
                self.entity_id,
                session,
                self.client.host,
                err,
            )

    async def _start_locked(self) -> None:
        if self._shutting_down or not self._media_url:
            return

        # Individual playback has strict priority. The group arbiter detaches
        # only this hub's dedicated group receiver and never touches the
        # individual receiver/watchdog.
        await self._claim_individual_audio()

        current_task = asyncio.current_task()
        if (
            self._watchdog_restart_task
            and self._watchdog_restart_task is not current_task
        ):
            self._watchdog_restart_task.cancel()
            self._watchdog_restart_task = None
        if self._watchdog_stable_task:
            self._watchdog_stable_task.cancel()
            self._watchdog_stable_task = None
        if self._watchdog_slow_retry_task:
            self._watchdog_slow_retry_task.cancel()
            self._watchdog_slow_retry_task = None

        await self._stop_local_ffmpeg("replace_before_start")
        await self.hass.async_add_executor_job(
            self.client.run_command,
            REMOTE_START_COMMAND,
        )

        writer: asyncio.StreamWriter | None = None
        last_error: Exception | None = None
        for _ in range(12):
            try:
                _, writer = await asyncio.wait_for(
                    asyncio.open_connection(self.client.host, RADIO_PORT),
                    timeout=1.0,
                )
                break
            except (OSError, asyncio.TimeoutError) as err:
                last_error = err
                await asyncio.sleep(0.15)
        if writer is None:
            with suppress(Exception):
                await self.hass.async_add_executor_job(
                    self.client.run_command, REMOTE_STOP_COMMAND
                )
            raise ConnectionError(
                f"individual audio receiver unavailable: {last_error}"
            )

        sock = writer.get_extra_info("socket")
        if sock is not None:
            with suppress(OSError):
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self._stream_writer = writer

        ffmpeg = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
        args = [
            ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_delay_max",
            "5",
            "-i",
            self._media_url,
            "-vn",
            "-ac",
            str(PCM_CHANNELS),
            "-ar",
            str(PCM_RATE),
            "-c:a",
            "pcm_s32le",
            "-f",
            "s32le",
            "pipe:1",
        ]

        try:
            self._ffmpeg = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except Exception as err:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()
            self._stream_writer = None
            with suppress(Exception):
                await self.hass.async_add_executor_job(
                    self.client.run_command, REMOTE_STOP_COMMAND
                )
            self._attr_state = MediaPlayerState.IDLE
            self.async_write_ha_state()
            if isinstance(err, FileNotFoundError):
                raise RuntimeError(
                    "FFmpeg was not found. On Home Assistant OS/Container it is "
                    "normally pre-installed; otherwise install/configure FFmpeg."
                ) from err
            raise

        self._ffmpeg_nice_applied = self._try_set_ffmpeg_priority(
            self._ffmpeg.pid
        )
        self._reset_live_gain()
        self._ffmpeg_session += 1
        session = self._ffmpeg_session
        self._ffmpeg_started_monotonic = time.monotonic()
        _LOGGER.info(
            "Aqara media FFmpeg started entity=%s session=%s pid=%s host=%s "
            "source=%s volume=%.3f muted=%s nice_target=%s nice_applied=%s",
            self.entity_id,
            session,
            self._ffmpeg.pid,
            self.client.host,
            self._safe_media_for_log(self._media_url),
            self._attr_volume_level or 0.0,
            self._attr_is_volume_muted,
            FFMPEG_NICE_TARGET,
            self._ffmpeg_nice_applied,
        )
        self._attr_state = MediaPlayerState.PLAYING
        self.async_write_ha_state()
        self._watch_task = self.hass.async_create_background_task(
            self._watch_ffmpeg(self._ffmpeg, writer),
            f"aqara_m1s_ffmpeg_watch_{self.entry.entry_id}",
        )
        self._watchdog_stable_task = self.hass.async_create_background_task(
            self._reset_watchdog_after_stable_playback(self._ffmpeg),
            f"aqara_m1s_stable_watch_{self.entry.entry_id}",
        )

    @staticmethod
    def _try_set_ffmpeg_priority(pid: int) -> bool:
        """Best-effort moderate CPU priority; never fail playback."""
        try:
            os.setpriority(os.PRIO_PROCESS, pid, FFMPEG_NICE_TARGET)
            return os.getpriority(os.PRIO_PROCESS, pid) <= FFMPEG_NICE_TARGET
        except (AttributeError, OSError, PermissionError) as err:
            _LOGGER.debug(
                "Could not apply FFmpeg nice=%s to pid=%s: %s",
                FFMPEG_NICE_TARGET,
                pid,
                err,
            )
            return False

    @staticmethod
    async def _read_ffmpeg_stderr(
        process: asyncio.subprocess.Process,
    ) -> str:
        if process.stderr is None:
            return ""
        lines: list[str] = []
        while True:
            line = await process.stderr.readline()
            if not line:
                break
            decoded = line.decode(errors="replace").strip()
            if decoded:
                lines.append(decoded)
                lines = lines[-40:]
        return "\n".join(lines)[-4000:]

    async def _watch_ffmpeg(
        self,
        process: asyncio.subprocess.Process,
        writer: asyncio.StreamWriter,
    ) -> None:
        """Pump decoded PCM to the hub and classify unexpected failures."""
        session = self._ffmpeg_session
        started = self._ffmpeg_started_monotonic
        stderr_task = self.hass.async_create_background_task(
            self._read_ffmpeg_stderr(process),
            f"aqara_m1s_ffmpeg_stderr_{self.entry.entry_id}",
        )
        stderr_text = ""
        pump_error: Exception | None = None
        try:
            if process.stdout is None:
                raise RuntimeError("FFmpeg PCM stdout pipe is unavailable")

            buffer = bytearray()
            while self._ffmpeg is process and not self._shutting_down:
                data = await process.stdout.read(PCM_CHUNK_BYTES * 4)
                if not data:
                    break
                buffer.extend(data)
                while len(buffer) >= PCM_CHUNK_BYTES:
                    raw_chunk = bytes(buffer[:PCM_CHUNK_BYTES])
                    del buffer[:PCM_CHUNK_BYTES]
                    writer.write(self._apply_live_pcm_gain(raw_chunk))
                    await asyncio.wait_for(
                        writer.drain(), timeout=WRITER_DRAIN_TIMEOUT
                    )

            await process.wait()
            stderr_text = await stderr_task

            if self._ffmpeg is not process or self._shutting_down:
                return
        except asyncio.CancelledError:
            if not stderr_task.done():
                stderr_task.cancel()
            with suppress(asyncio.CancelledError):
                await stderr_task
            _LOGGER.debug(
                "Aqara media PCM watcher cancelled intentionally "
                "entity=%s session=%s pid=%s",
                self.entity_id,
                session,
                process.pid,
            )
            raise
        except Exception as err:
            pump_error = err
            if process.returncode is None:
                process.terminate()
                with suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(process.wait(), timeout=2.0)
                if process.returncode is None:
                    process.kill()
                    await process.wait()
            if not stderr_task.done():
                with suppress(asyncio.TimeoutError):
                    stderr_text = await asyncio.wait_for(
                        stderr_task, timeout=1.0
                    )
            elif not stderr_task.cancelled():
                with suppress(Exception):
                    stderr_text = stderr_task.result()

            if self._ffmpeg is not process or self._shutting_down:
                return
        finally:
            if not stderr_task.done():
                stderr_task.cancel()
                with suppress(asyncio.CancelledError):
                    await stderr_task

        runtime = max(0.0, time.monotonic() - started) if started else 0.0
        self._ffmpeg = None
        self._ffmpeg_started_monotonic = None
        if self._stream_writer is writer:
            self._stream_writer = None
        writer.close()
        with suppress(Exception):
            await writer.wait_closed()

        stable_task = self._watchdog_stable_task
        self._watchdog_stable_task = None
        await self._cancel_task(stable_task)

        if not self.coordinator.last_update_success:
            failure_kind = "hub_offline"
            failure_detail = "The coordinator reports the hub offline"
        elif isinstance(pump_error, asyncio.TimeoutError):
            failure_kind = "tcp_pcm_backpressure"
            failure_detail = (
                f"PCM/TCP writer did not drain within "
                f"{WRITER_DRAIN_TIMEOUT:.1f}s"
            )
        elif pump_error is not None:
            failure_kind = "hub_audio"
            failure_detail = f"PCM/TCP writer failed: {pump_error}"
        else:
            failure_kind, failure_detail = self._classify_ffmpeg_failure(
                stderr_text, runtime
            )
        self._last_failure_kind = failure_kind
        self._last_failure_detail = failure_detail
        self._recovery_pending = True

        _LOGGER.warning(
            "Aqara media FFmpeg/PCM ended unexpectedly entity=%s session=%s "
            "pid=%s host=%s returncode=%s runtime=%.1fs "
            "playback_requested=%s failure_kind=%s source=%s "
            "pump_error=%r stderr=%r",
            self.entity_id,
            session,
            process.pid,
            self.client.host,
            process.returncode,
            runtime,
            self._resume_after_reconnect,
            failure_kind,
            self._safe_media_for_log(self._media_url),
            pump_error,
            stderr_text,
        )
        self._attr_state = MediaPlayerState.IDLE
        self.async_write_ha_state()

        if failure_kind in ("tcp_pcm_backpressure", "hub_audio", "unknown"):
            await self._log_remote_audio_snapshot(session)
        else:
            _LOGGER.info(
                "Aqara media skipped hub snapshot entity=%s session=%s "
                "failure_kind=%s detail=%s",
                self.entity_id,
                session,
                failure_kind,
                failure_detail,
            )

        if (
            not self._shutting_down
            and self._resume_after_reconnect
            and self._resume_media_id
        ):
            if failure_kind == "hub_offline":
                _LOGGER.warning(
                    "Aqara media recovery waiting for hub reconnect "
                    "entity=%s host=%s",
                    self.entity_id,
                    self.client.host,
                )
            else:
                self._schedule_watchdog_restart(failure_kind)

        if self._watch_task is asyncio.current_task():
            self._watch_task = None

    def _schedule_watchdog_restart(self, failure_kind: str | None = None) -> None:
        if self._shutting_down:
            return
        failure_kind = failure_kind or self._last_failure_kind or "unknown"
        if self._watchdog_restart_attempts >= WATCHDOG_MAX_RESTARTS:
            if failure_kind == "hub_offline":
                _LOGGER.warning(
                    "Aqara media watchdog exhausted %s fast retries for %s; "
                    "waiting for a real hub reconnect",
                    WATCHDOG_MAX_RESTARTS,
                    self.entity_id,
                )
                return
            self._schedule_slow_retry(failure_kind)
            return
        if self._watchdog_restart_task and not self._watchdog_restart_task.done():
            return
        self._watchdog_restart_task = self.hass.async_create_background_task(
            self._async_watchdog_restart(failure_kind),
            f"aqara_m1s_restart_watch_{self.entry.entry_id}",
        )

    def _schedule_slow_retry(self, failure_kind: str) -> None:
        if self._shutting_down or not self._resume_after_reconnect:
            return
        if self._watchdog_slow_retry_task and not self._watchdog_slow_retry_task.done():
            return
        _LOGGER.warning(
            "Aqara media watchdog exhausted %s fast retries for %s; "
            "scheduling slow retry in %.0fs failure_kind=%s",
            WATCHDOG_MAX_RESTARTS,
            self.entity_id,
            WATCHDOG_SLOW_RETRY_DELAY,
            failure_kind,
        )
        self._watchdog_slow_retry_task = self.hass.async_create_background_task(
            self._async_watchdog_slow_retry(failure_kind),
            f"aqara_m1s_slow_retry_{self.entry.entry_id}",
        )

    async def _async_watchdog_restart(self, failure_kind: str) -> None:
        try:
            await asyncio.sleep(WATCHDOG_RESTART_DELAY)
            if (
                not self._resume_after_reconnect
                or not self._resume_media_id
                or self._attr_state == MediaPlayerState.PLAYING
            ):
                return
            if not self.coordinator.last_update_success:
                self._last_failure_kind = "hub_offline"
                _LOGGER.warning(
                    "Aqara media watchdog paused because hub is offline "
                    "entity=%s host=%s",
                    self.entity_id,
                    self.client.host,
                )
                return
            self._watchdog_restart_attempts += 1
            _LOGGER.warning(
                "Aqara media watchdog restarting %s (%s/%s) failure_kind=%s",
                self.entity_id,
                self._watchdog_restart_attempts,
                WATCHDOG_MAX_RESTARTS,
                failure_kind,
            )
            await self.async_media_play()
            # Very short source failures can finish while this retry task is
            # still active. Give the watcher a moment to classify the exit,
            # then explicitly queue the next attempt after releasing this task.
            await asyncio.sleep(0.5)
            if (
                self._resume_after_reconnect
                and self._attr_state != MediaPlayerState.PLAYING
                and self.coordinator.last_update_success
            ):
                next_kind = self._last_failure_kind or failure_kind
                self._watchdog_restart_task = None
                self._schedule_watchdog_restart(next_kind)
                return
        except asyncio.CancelledError:
            return
        except Exception as err:
            self._last_failure_kind = (
                "source_unavailable" if failure_kind == "source_unavailable" else "unknown"
            )
            self._last_failure_detail = str(err)
            _LOGGER.warning(
                "Aqara media watchdog restart failed for %s failure_kind=%s: %s",
                self.entity_id,
                self._last_failure_kind,
                err,
            )
            if self._resume_after_reconnect:
                self._watchdog_restart_task = None
                self._schedule_watchdog_restart(self._last_failure_kind)
                return
        finally:
            if self._watchdog_restart_task is asyncio.current_task():
                self._watchdog_restart_task = None

    async def _async_watchdog_slow_retry(self, failure_kind: str) -> None:
        try:
            await asyncio.sleep(WATCHDOG_SLOW_RETRY_DELAY)
            if (
                not self._resume_after_reconnect
                or not self._resume_media_id
                or self._attr_state == MediaPlayerState.PLAYING
            ):
                return
            if not self.coordinator.last_update_success:
                self._last_failure_kind = "hub_offline"
                _LOGGER.warning(
                    "Aqara media slow retry deferred because hub is offline "
                    "entity=%s host=%s",
                    self.entity_id,
                    self.client.host,
                )
                return
            _LOGGER.warning(
                "Aqara media watchdog slow retry entity=%s failure_kind=%s source=%s",
                self.entity_id,
                failure_kind,
                self._safe_media_for_log(self._media_url),
            )
            # A new slow-retry cycle gets three fresh fast attempts if the
            # source or hub receiver is still unavailable.
            self._watchdog_restart_attempts = 0
            await self.async_media_play()
        except asyncio.CancelledError:
            return
        except Exception as err:
            self._last_failure_detail = str(err)
            _LOGGER.warning(
                "Aqara media slow retry failed entity=%s failure_kind=%s: %s",
                self.entity_id,
                failure_kind,
                err,
            )
            if self._resume_after_reconnect:
                self._watchdog_slow_retry_task = None
                self._schedule_slow_retry(failure_kind)
                return
        finally:
            if self._watchdog_slow_retry_task is asyncio.current_task():
                self._watchdog_slow_retry_task = None

    async def _reset_watchdog_after_stable_playback(
        self, process: asyncio.subprocess.Process
    ) -> None:
        try:
            await asyncio.sleep(WATCHDOG_STABLE_SECONDS)
            if self._ffmpeg is process and process.returncode is None:
                previous_attempts = self._watchdog_restart_attempts
                previous_kind = self._last_failure_kind
                self._watchdog_restart_attempts = 0
                if self._watchdog_slow_retry_task:
                    self._watchdog_slow_retry_task.cancel()
                    self._watchdog_slow_retry_task = None
                if self._recovery_pending:
                    _LOGGER.info(
                        "Aqara media playback recovered and remained stable "
                        "entity=%s session=%s host=%s previous_failure_kind=%s "
                        "fast_attempts=%s source=%s",
                        self.entity_id,
                        self._ffmpeg_session,
                        self.client.host,
                        previous_kind or "unknown",
                        previous_attempts,
                        self._safe_media_for_log(self._media_url),
                    )
                self._recovery_pending = False
                self._last_failure_kind = None
                self._last_failure_detail = None
                self.async_write_ha_state()
        except asyncio.CancelledError:
            return
        finally:
            if self._watchdog_stable_task is asyncio.current_task():
                self._watchdog_stable_task = None

    async def _stop_local_ffmpeg(self, reason: str) -> None:
        process = self._ffmpeg
        session = self._ffmpeg_session
        started = self._ffmpeg_started_monotonic
        self._ffmpeg = None
        self._ffmpeg_started_monotonic = None
        watch_task = self._watch_task
        self._watch_task = None
        await self._cancel_task(watch_task)
        writer = self._stream_writer
        self._stream_writer = None
        if writer is not None:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()
        self._ffmpeg_nice_applied = False
        if process is None:
            return
        runtime = max(0.0, time.monotonic() - started) if started else 0.0
        if process.returncode is None:
            process.terminate()
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(process.wait(), timeout=2)
            if process.returncode is None:
                process.kill()
                await process.wait()
        _LOGGER.info(
            "Aqara media FFmpeg stopped intentionally entity=%s session=%s "
            "pid=%s host=%s reason=%s returncode=%s runtime=%.1fs",
            self.entity_id,
            session,
            process.pid,
            self.client.host,
            reason,
            process.returncode,
            runtime,
        )

    async def _stop_locked(self, update_state: bool, reason: str) -> None:
        await self._stop_local_ffmpeg(reason)
        try:
            await self.hass.async_add_executor_job(
                self.client.run_command,
                REMOTE_STOP_COMMAND,
            )
        except Exception as err:  # Hub may already be offline during unload.
            _LOGGER.debug("Could not stop Aqara radio receiver: %s", err)
        if update_state:
            self._attr_state = MediaPlayerState.IDLE
            self.async_write_ha_state()
