## 0.3.36

- Group YT/YTM audio speed test remains at 4% (`atempo=1.04`).
- Individual YT/YTM audio speed test is 3% (`atempo=1.03`).
- Group Play/Seek sender LOADING hold remains 4 seconds; all other add-on behavior and settings are unchanged from 0.3.35.
- No integration changes.

## 0.3.35

- Group YT/YTM sender LOADING hold changed from 5 seconds to 4 seconds; the same path covers initial Play and every Seek.
- Removed the experimental fixed 5-second end wait and restored the prior 0.3.33 EOF/drain and +0.75 s group duration-guard behavior.
- Group YT/YTM audio only is time-compressed by 3% (`atempo=1.03`) in the add-on before Home Assistant; individual YT/YTM and Radio are unchanged.
- No integration changes.

## 0.3.34

- Group YT/YTM start hold changed from 6 seconds to 5 seconds.
- Group YT/YTM end transition now waits 5 seconds before Next, on both HA EOF/idle and duration-guard paths.
- No integration, individual-player, ownership, mapping, or other settings changed.

## 0.3.33 - 6 s YT/YTM group sender buffering

- Based strictly on v0.3.32 / v0.3.24 runtime.
- Group YT/YTM Play keeps the Cast sender in LOADING for 6 seconds after Home Assistant accepts the new stream, then releases PLAYING so the YTM counter starts after the measured group buffering interval.
- YT/YTM Seek uses the same 6-second LOADING window because seek restarts through the same startAt() path.
- Individual players, group membership/restore, ownership, mapping, STOP/PLAY boundaries, Radio and add-on options are unchanged.

## 0.3.24 - 500 ms group STOP settle before YT/YTM Play

- Based strictly on v0.3.23; ownership, individual group restoration, mapping, queue and EOF logic are unchanged.
- After a group `media_stop` is confirmed, waits 500 ms before issuing the next YT/YTM `play_media`, reproducing the proven manual STOP -> settle -> PLAY boundary with a longer transport/ALSA settle window.

## 0.3.23 - Source ownership + exact individual group restore

- Based strictly on v0.3.22; no audio extraction, queue timing, title, mapping or group-end changes.
- When Home Assistant changes from the active YT/YTM stream to Radio/another media source, the add-on relinquishes ownership and publishes STOP to the Cast sender without sending `media_stop` to the new HA source.
- Stale Pause, Resume, Seek, Next, Previous and Volume commands from the old YT/YTM session are blocked from controlling the newly selected HA source. A fresh explicit YT/YTM Play may acquire the target again.
- Restores the exact v0.3.7 individual membership behavior: capture `*_include_in_m1s_media_group` once before the first YT/YTM removal; restore on real Stop only if it was originally ON; leave originally standalone hubs standalone.
- Keeps the fixed receiver-to-hub/include-switch mapping from v0.3.5; no fallback remapping or runtime mapping mutation.

## 0.3.22 - Deterministic group end guard

- Rebased on the byte-stable 0.3.18/0.3.21 runtime; direct yt-dlp audio remains unchanged.
- Keeps state-based natural EOF as the primary completion path.
- Adds a group-only duration guard at the real track duration plus 750 ms.
- The guard advances only while Home Assistant still reports the exact active YouTube stream, preventing unrelated sources from being reclaimed.
- Stops the group before queue advance so a missing group IDLE transition cannot leave aplay repeating the final fragment.
- Individual playback, buffers, PCM pacing, synchronization and resync are unchanged.

## 0.3.21 - Rollback to stable 0.3.18 runtime

- Runtime, DIAL discovery, queue handling and direct yt-dlp audio path are byte-identical to 0.3.18.
- Removes every experimental 0.3.19/0.3.20 runtime change.
- Uses a higher version number so Home Assistant can install it directly over 0.3.20 without a manual downgrade.

## 0.3.18

- Seek now reuses the single proven clean group start boundary from `startAt()` instead of issuing a redundant pre-STOP.
- Natural track advance no longer calls `pause()`/STOP before `next()`; the next item's `startAt()` performs the one authoritative STOP -> confirmation -> teardown -> PLAY sequence.
- Removes redundant transport resets/delays without changing clean Play, title lookup, mapping, or finite-EOF detection.

## 0.3.17
- Compatibility-only packaging fix for 0.3.16.
- Restores deprecated resume_interrupted_* options in add-on schema so existing Supervisor-stored options remain valid; runtime still ignores them.
- Cleans repository ZIP structure; no nested build/work directory.
- Audio/runtime logic is unchanged from 0.3.16.

# Changelog

## 0.3.16

- Group Play now mirrors the proven manual STOP -> PLAY order: Home Assistant STOP is sent before the obsolete HTTP/yt-dlp stream is terminated; the fixed 300 ms normal-path delay was removed.
- Queue advance is no longer scheduled from YouTube metadata duration. A finite track advances only after Home Assistant reports that the exact YouTube stream reached IDLE, followed by a drain grace derived from the integration's `group_remote_prefill_seconds`.
- Mid-track HTTP closes still never trigger resume or next.
- STOP/Pause/Seek now stop Home Assistant before terminating the old audio child. Retry backoff is used only after a real failure.
- Removed the obsolete interruption-resume delay options from the add-on config.

## 0.3.15

- Based strictly on v0.3.14 local-queue-clean behavior; no interruption auto-resume, sender watchdog, notification detection, or same-track timeline logic was reintroduced.
- Group YT/YTM playback now performs a clean Home Assistant media_stop (with short retry and 300 ms settle) before each new group play, reproducing the manually verified STOP -> PLAY sequence that starts the M1S hubs in sync.
- Restored the lightweight YouTube oEmbed title lookup from v0.3.9 before the single play_media call, so Home Assistant receives the real track title instead of `YouTube <video_id>` when the sender omits metadata.

## 0.3.14

- Rebased directly on v0.3.5 fixed receiver mapping and local queue/autoplay behaviour.
- Disabled interruption auto-resume completely; HTTP/client closes never restart the current item.
- Track-boundary queue advance now requires a successful Home Assistant media_stop; transient 502 errors are retried up to three times and next is not issued over an active old source.
- The logical track clock starts only after Home Assistant accepts play_media, and the end boundary includes a conservative downstream drain margin to avoid cutting buffered group audio early.
- No sender watchdog, wall-clock same-URL recovery, notification detection, or track-boundary sender policy from later experimental builds is included.

## 0.3.5

- Based directly on the last correctly mapped build, 0.3.3.
- Keeps each Cast receiver bound to the exact individual M1S media player and group switch
  discovered at startup; no fallback remapping and no runtime mutation of the receiver definition.
- Before individual playback, sends `switch.turn_off` directly to the already mapped
  `*_include_in_m1s_media_group` switch, then waits 300 ms.
- Does not depend on the switch reporting `on`, avoiding stale Home Assistant state checks.

## 0.3.2

- Fixed short external audio interruptions, such as phone/mail notification sounds routed
  through the same Aqara M1S target, being treated as the end of the YouTube Music track.
- When the active HTTP stream is closed before the track is near its natural end, the
  add-on now resumes the same track instead of advancing to the next queue item.
- Added `resume_interrupted_stream` and `resume_interrupted_delay_ms`; the default resume
  delay is 300 ms so brief notification sounds do not create a long silence.
- Removed `stage: experimental` from the Home Assistant add-on manifest.

## 0.3.1

- Fixed Home Assistant image build failure by pinning `yt-cast-receiver` back to
  the latest version published on npm, `2.1.0`.
- Kept the local queue/end-of-track advancement logic from 0.3.0.
- Updated documentation to reflect the npm-published dependency version.

## 0.3.0

- Added end-of-track queue advancement for YouTube / YouTube Music Cast sessions.
- When playback reaches the known duration, the add-on now asks the receiver queue for
  the next item, including YouTube autoplay when the sender provides it.
- Preserved Cast session state across implicit sender disconnects so a sleeping phone or
  temporary network drop does not immediately clear the queue.
- Enabled autoplay-on-connect explicitly for the receiver app.
- Added queue and autoplay logging to make playlist / Up Next behavior visible in add-on logs.

## 0.2.0

- Added automatic Cast receivers for individual Aqara M1S media players.
- Kept the existing M1S Media Group receiver.
- Added one DIAL port per receiver starting from the configured base port.
- Added per-receiver audio process isolation.
- Added per-receiver persistent datastore.
- Removed blocking metadata lookup from the playback startup path.
- Metadata now resolves asynchronously after playback has started.

## 0.1.1

- Fixed npm dependency to published `yt-cast-receiver` 2.1.0.

## 0.1.0

- Initial YouTube / YouTube Music DIAL/Lounge receiver.
