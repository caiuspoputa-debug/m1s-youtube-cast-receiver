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
