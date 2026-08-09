# v0.5.13 TEST

- Added periodic 10-minute receiver-only drift guard for long-running M1S Media Group playback.
- The guard pauses the shared PCM broadcaster at a 20 ms boundary, rebuilds active hub `nc`/`aplay` receivers, reapplies the 1.5 s common silent lead-in, and resumes the same FFmpeg process.
- Periodic drift correction therefore preserves finite-media position instead of restarting the source from the beginning.
- Existing full-resync recovery paths remain for persistent lag, queue overflow, PCM stall and member rejoin.
- Retains v0.5.11 WAV/ZIP batch upload (up to 64 WAV files) and multi-delete.
- TEST status retained pending long-run physical observation.

# Changelog

## 0.5.11 - test

- Configure → Delete WAV now uses Home Assistant's native multi-select selector, so multiple managed WAV files can be selected and deleted in one operation
- Home Assistant's native FileSelector still returns a single uploaded file; Configure therefore keeps a single file picker but now accepts either one WAV or one ZIP batch
- a ZIP batch may contain up to 64 WAV files, with the existing 20 MiB limit per WAV and a 100 MiB total batch/archive safety limit
- ZIP processing is in-memory, ignores non-WAV entries, rejects encrypted archives and duplicate WAV basenames, and never extracts paths onto the Home Assistant filesystem
- all v0.5.10 audio synchronization, watchdog, TCP backpressure and Fine Volume Trim behavior is retained unchanged

## 0.5.10 - test

- fixed false full-group resynchronisations caused by a single 120 ms queue spike
- the 120 ms member-lag threshold must now persist continuously for 1.0 second before a full resync is requested
- lag detection is suppressed for the first 8 seconds after every group stream start/resync so normal receiver startup cannot trigger another resync
- a completely full 250 ms member queue still forces an immediate full-group resync because synchronization is already lost
- group TCP writer drain timeout increased from 1.0 s to 2.0 s to tolerate brief LAN scheduling/backpressure spikes without hiding real stalls
- group watchdog restart logs now include the last recorded failure reason
- individual media-player TCP writer drain timeout increased from 1.0 s to 2.0 s
- an individual writer timeout is now classified explicitly as `tcp_pcm_backpressure` instead of the misleading generic `hub_audio`; remote audio snapshots are still captured
- retains the v0.5.9 Fine Volume Trim behavior unchanged

## 0.5.9 - test

- added a separate **Fine Volume Trim** slider to every individual media player
- trim range is `-1.00%` to `+1.00%` in `0.01%` steps and is applied as absolute percentage points after the main 0.1%-step player volume
- example: main volume `6.0%` plus trim `+0.27%` produces `6.27%` effective PCM gain
- fine trim uses the existing interruption-free live S32_LE PCM gain path; changing it does not restart FFmpeg, TCP, `nc` or `aplay`
- main volume `0%` remains hard silence even with a positive trim; mute also remains hard silence
- the old pre-v0.5.6 absolute fine-volume entity is not reused; v0.5.9 creates a new `*_radio_fine_trim` entity to avoid semantic/state collisions
- retains all v0.5.8 group resynchronization and PCM-progress watchdog changes unchanged

## 0.5.8 - test

- group synchronization now has priority over uninterrupted playback: a recovered or lagging hub causes a controlled full-group restart instead of being allowed to continue with a permanent offset
- reduced the per-hub PCM queue ceiling from 1.0 s to 0.25 s and added a 120 ms lag threshold that requests full resynchronisation
- the broadcaster yields after every 20 ms PCM chunk so writer tasks can drain in real time even when FFmpeg stdout arrives in larger bursts
- a hub that returns online is allowed an 8-second stabilization window before it participates in the next full-group synchronization
- added a PCM-progress health watchdog: if FFmpeg remains alive but no PCM arrives for 12 seconds, the complete group is restarted automatically
- the 30-second stable-watch now clears watchdog failures only when PCM is actually flowing and at least one group receiver is active
- added diagnostics for PCM age, per-member queue depth, resync threshold and synchronization policy

## 0.5.7

- added **Change Wi-Fi network** to the integration Configure menu
- the Wi-Fi password is masked in the Home Assistant form and is not stored in config-entry data or options
- the integration stages the candidate only on the hub and delegates validation/rollback to the optional sanitized Wi-Fi recovery module
- hardened candidate validation by clearing a stale interface IPv4 before the new connection attempt, preventing an old address from being mistaken for success
- renamed the Configure menu from sound-only management to general Aqara M1S management
- added Romanian/English documentation links and documented the safe Wi-Fi change workflow

## 0.5.6

- moved every individual media player to the same interruption-free live PCM software-gain model already used by the group
- changed the native individual and group media-player volume step from 0.2% to 0.1% across 0-100%
- removed the separate individual and group fine-volume Number entities; the native media-player slider is now the only stream-volume control
- added a 40 ms software gain ramp for volume and mute changes to reduce clicks without restarting FFmpeg, TCP, `nc` or `aplay`
- gave FFmpeg a best-effort moderate CPU priority (`nice -5`) in Home Assistant and `aplay` a smaller best-effort priority (`nice -3`) on each hub
- priority changes use normal Linux niceness only; they never use realtime scheduling, terminate other processes, or fail playback when the OS refuses the requested priority


## 0.5.5

- removed all FFmpeg and receiver restarts caused by M1S media-group volume or mute changes
- moved group gain control into the existing Home Assistant PCM broadcast loop
- each new volume value is applied to the next common 20 ms S32_LE chunk while preserving the same FFmpeg process, TCP sessions, queues and synchronization timeline
- retained the 0.2% volume scale and full-group resynchronisation when a hub actually rejoins
- added diagnostics: `volume_apply_mode: live_pcm_software_gain` and `volume_stream_restart: false`

## 0.5.4

- changed M1S media-group volume handling to debounce slider updates
- intermediate slider positions now only update the pending Home Assistant state
- the shared FFmpeg timeline restarts once, 0.8 seconds after the last volume call
- added group diagnostics: `volume_apply_mode`, `volume_settle_seconds`, `volume_apply_pending`, `applied_volume_level`, and `applied_is_volume_muted`
- retained the 0.2% volume scale and full-group resynchronisation behavior

## 0.5.3

- changed late/recovered group-member handling from live insertion to a full group restart
- when a selected online hub returns while the group is playing, all group receivers and the single shared FFmpeg process are restarted together
- retained removal of an offline or individually claimed hub without interrupting the remaining group
- added a 30-second retry guard after a failed receiver preparation to prevent repeated rapid full-group interruptions
- added group diagnostics: `rejoin_sync_mode`, `full_resync_count`, `last_full_resync_reason`, and `full_resync_retry_seconds`

## 0.5.2

- changed individual and group media-player volume normalization to one uniform 0.2% step across 0-100%
- changed volume up/down actions to 0.2% per press for individual and group players
- expanded the precise individual and group number sliders to 0-100% with a 0.2% step
- retained the precise number sliders because Home Assistant documents `volume_step` for volume up/down actions, not as a guarantee for every frontend slider drag

## 0.5.1

- fix Home Assistant platform forwarding by using explicit platform names
- no audio, synchronization, watchdog or entity behavior changes

## 0.5.0 - test

- Rebuilt from the clean v0.3.7 integration.
- Preserved all individual media players, fine volume and automatic recovery.
- Fixed the undefined delayed-resume watchdog failure variable.
- Added one shared-timeline media group with a single FFmpeg PCM source.
- Added 20 ms sequence framing and a 1.5 s common silent synchronization gate.
- Added late-member synchronization at a future shared sequence.
- Added per-hub skip/retry without stopping the rest of the group.
- Added strict individual-player priority and dedicated group resources on TCP 12347.
- Added per-hub group membership switches and group fine volume.
- Added physical-button event entity and six MQTT device triggers.

## 0.1.0

- New integration domain: `aqara_m1s_zigbee_router`.
- Direct JN5189 RGB UART control using `A5 R G B checksum`.
- Shared 15-second hub availability coordinator.
- Light, radio, volume and sensors become unavailable when the hub is offline.
- Sound buttons intentionally remain visible while offline.
- v0.5.9 radio pipeline retained, including PID-scoped forced cleanup.
- v0.5.9 FFmpeg sound pipeline retained for fine volume and no LED side effect.
- Multi-hub action routing corrected by hub IP.
- WAV upload, deletion and sound-list refresh actions added.
- WAV upload validates PCM, mono, 32000 Hz and signed 32-bit samples.
- Upload paths are restricted to `/data/musics` and files to 20 MiB.
- Stock-firmware Telnet preparation sequence documented as `5-2-2-2-2-2-2`.
- Local Home Assistant brand icon included in 256 px and 512 px variants.
