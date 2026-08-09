from __future__ import annotations

import asyncio
import logging
import os
import shlex
import shutil
from contextlib import suppress

from homeassistant.core import HomeAssistant

from .client import AqaraM1SClient

_LOGGER = logging.getLogger(__name__)

SOURCE_PORT = 12347
SINK_PORT = 12348
REMOTE_FIFO = "/tmp/aqara_m1s_sound_fifo"
REMOTE_SOURCE_PID = "/tmp/aqara_m1s_sound_source_nc.pid"
REMOTE_SINK_PID = "/tmp/aqara_m1s_sound_sink_nc.pid"
REMOTE_APLAY_PID = "/tmp/aqara_m1s_sound_aplay.pid"
FFMPEG_NICE_TARGET = -5
APLAY_NICE_TARGET = -3

REMOTE_STOP_COMMAND = (
    f"for f in {REMOTE_SOURCE_PID} {REMOTE_SINK_PID} {REMOTE_APLAY_PID}; do "
        '[ -f "$f" ] && kill -9 "$(cat "$f")" 2>/dev/null; '
    "done; "
    f"rm -f {REMOTE_SOURCE_PID} {REMOTE_SINK_PID} {REMOTE_APLAY_PID} {REMOTE_FIFO}"
)


def remote_start_command(path: str) -> str:
    """Build the hub-side one-shot source and sink pipeline."""
    source = shlex.quote(path)
    return (
        REMOTE_STOP_COMMAND
        + f"; mkfifo {REMOTE_FIFO}; "
        + f"nc -l -p {SINK_PORT} < /dev/null > {REMOTE_FIFO} "
          "2>/tmp/aqara_m1s_sound_sink_nc.log & "
        + f"echo $! > {REMOTE_SINK_PID}; "
        + f"aplay -t raw -f S32_LE -c 1 -r 32000 {REMOTE_FIFO} </dev/null "
          ">/tmp/aqara_m1s_sound_aplay.log 2>&1 & "
        + f"echo $! > {REMOTE_APLAY_PID}; "
        + f"APID=$(cat {REMOTE_APLAY_PID}); "
          f"renice {APLAY_NICE_TARGET} -p \"$APID\" "
          ">/tmp/aqara_m1s_sound_aplay_renice.log 2>&1 || true; "
        + f"cat {source} | nc -l -p {SOURCE_PORT} "
          ">/dev/null 2>/tmp/aqara_m1s_sound_source_nc.log & "
        + f"echo $! > {REMOTE_SOURCE_PID}"
    )


class AqaraM1SSoundPlayer:
    """Play one hub WAV through local FFmpeg volume filtering."""

    def __init__(
        self,
        hass: HomeAssistant,
        client: AqaraM1SClient,
    ) -> None:
        self.hass = hass
        self.client = client
        self._lock = asyncio.Lock()
        self._ffmpeg: asyncio.subprocess.Process | None = None
        self._watch_task: asyncio.Task | None = None

    async def async_play(self, path: str, volume: int) -> None:
        """Play exactly one WAV with software volume and no LED effect."""
        safe_volume = max(0, min(100, int(volume))) / 100.0
        async with self._lock:
            await self._stop_locked()
            await self.hass.async_add_executor_job(
                self.client.run_command,
                remote_start_command(path),
            )
            await asyncio.sleep(0.35)

            ffmpeg = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
            input_url = f"tcp://{self.client.host}:{SOURCE_PORT}?tcp_nodelay=1"
            output_url = f"tcp://{self.client.host}:{SINK_PORT}?tcp_nodelay=1"
            args = [
                ffmpeg,
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "warning",
                "-re",
                "-i",
                input_url,
                "-vn",
                "-ac",
                "1",
                "-ar",
                "32000",
                "-filter:a",
                f"volume={safe_volume:.4f}",
                "-c:a",
                "pcm_s32le",
                "-f",
                "s32le",
                output_url,
            ]

            try:
                process = await asyncio.create_subprocess_exec(
                    *args,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
            except FileNotFoundError as err:
                await self._remote_stop()
                raise RuntimeError("FFmpeg was not found on Home Assistant") from err

            self._ffmpeg = process
            self._try_set_ffmpeg_priority(process.pid)
            self._watch_task = self.hass.async_create_task(
                self._watch(process)
            )

    @staticmethod
    def _try_set_ffmpeg_priority(pid: int) -> bool:
        """Best-effort normal Linux niceness; never fail sound playback."""
        try:
            os.setpriority(os.PRIO_PROCESS, pid, FFMPEG_NICE_TARGET)
            return os.getpriority(os.PRIO_PROCESS, pid) <= FFMPEG_NICE_TARGET
        except (AttributeError, OSError, PermissionError) as err:
            _LOGGER.debug(
                "Could not apply sound FFmpeg nice=%s to pid=%s: %s",
                FFMPEG_NICE_TARGET,
                pid,
                err,
            )
            return False

    async def _watch(self, process: asyncio.subprocess.Process) -> None:
        stderr = b""
        try:
            _, stderr = await process.communicate()
        except asyncio.CancelledError:
            return

        if self._ffmpeg is not process:
            return

        self._ffmpeg = None
        self._watch_task = None
        if process.returncode not in (0, -15):
            _LOGGER.warning(
                "Aqara M1S sound FFmpeg exited with code %s: %s",
                process.returncode,
                stderr.decode(errors="ignore")[-1000:],
            )
        elif process.returncode == 0:
            # Let aplay drain its final buffered PCM frames before cleanup.
            await asyncio.sleep(0.2)
        await self._remote_stop()

    async def async_stop(self) -> None:
        async with self._lock:
            await self._stop_locked()

    async def _stop_locked(self) -> None:
        process = self._ffmpeg
        self._ffmpeg = None
        if self._watch_task:
            self._watch_task.cancel()
            self._watch_task = None
        if process is not None and process.returncode is None:
            process.terminate()
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(process.wait(), timeout=2)
            if process.returncode is None:
                process.kill()
                await process.wait()
        await self._remote_stop()

    async def _remote_stop(self) -> None:
        try:
            await self.hass.async_add_executor_job(
                self.client.run_command,
                REMOTE_STOP_COMMAND,
            )
        except Exception as err:
            _LOGGER.debug("Could not stop Aqara sound pipeline: %s", err)
