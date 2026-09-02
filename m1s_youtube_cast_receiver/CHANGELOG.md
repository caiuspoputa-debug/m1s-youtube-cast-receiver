# 0.3.8

- Stops the active YouTube / YouTube Music playback when the last sender disappears through an implicit disconnect (for example when the sender app is closed/killed).
- Uses a short configurable grace period (`sender_disconnect_stop_delay_ms`, default 1000 ms); a fast sender reconnect cancels the Stop.
- Explicit "Stop Casting" remains handled by `yt-cast-receiver` itself.
- The normal `doStop()` path is used, so an individual M1S hub is restored to the media group only if it was in the group before the YouTube session.
- Keeps the v0.3.7 hub mapping, manual Stop handling and interruption-resume logic unchanged.

# Changelog

## 0.3.7

- Remembers whether each individual M1S hub was in the M1S media group immediately before its current YouTube / YouTube Music session.
- The membership state is captured only once per session, before the first automatic group removal; seek, next-track and interruption resume do not overwrite it.
- On Stop, automatically restores the individual hub to the group only when it was in the group before YouTube playback began.
- A hub that was already outside the group remains outside after Stop.
- If the original group state cannot be read reliably, restoration is skipped as the safe default.
- Keeps the v0.3.5 receiver/hub mapping and the v0.3.6 manual Stop/interruption fix unchanged.

## 0.3.6

- Distinguishes an intentional Stop/Pause on an individual Home Assistant media player from a short external audio interruption.
- During the existing 300 ms interruption window, samples the target player's Home Assistant state.
- If the player remains `idle`/`off` or is `paused`, the Cast session is stopped and the current YouTube track is not auto-resumed.
- If another media item becomes active, the interruption is treated as a notification/announcement and the same YouTube track is resumed.
- Prevents the old false auto-resume path from unexpectedly removing the hub from the M1S media group after a manual Stop.
- Keeps the v0.3.5 receiver/hub mapping logic unchanged.

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
