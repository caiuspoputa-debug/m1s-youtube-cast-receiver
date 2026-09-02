# M1S YouTube Cast Receiver

Home Assistant app/add-on that exposes the Aqara M1S Media Group and the individual
Aqara M1S media players as YouTube / YouTube Music DIAL receivers.

## v0.3.6

- When you cast to an individual M1S that is currently included in the M1S media group,
  the add-on can remove it from the group automatically before playback starts.
- This is enabled by default with `auto_remove_individual_from_group: true`.
- The default wait after removing the player from the group is 300 ms, controlled by
  `auto_remove_group_delay_ms`.

## v0.3.2

- Prevents short external notification sounds from being interpreted as a finished YouTube
  Music track.
- If the M1S closes the add-on stream before the track is near its real end, the add-on
  resumes the same track instead of skipping to the next queue item.
- The default resume delay is 300 ms. Set `resume_interrupted_delay_ms: 0` for immediate
  resume, or raise it if another sound needs more time.
- Removes the experimental stage marker from the Home Assistant add-on manifest.

## v0.3.1

- Fixes the Home Assistant image build failure from v0.3.0 by using the latest
  `yt-cast-receiver` release that is actually published on npm: `2.1.0`.
- Keeps the queue-aware playback progression added in v0.3.0.

## v0.3.0

- Adds queue-aware playback progression for YouTube / YouTube Music Cast sessions.
- At the end of a track, the add-on now asks the Cast receiver queue for the next item.
  This supports explicit queues, playlists, and YouTube autoplay when the sender provides
  the needed queue context.
- Cast state is kept across implicit sender disconnects, which helps long playback sessions
  continue if the phone sleeps or briefly leaves the network.
- Add-on logs now include queue, playlist, and autoplay mode changes for easier testing.

## v0.2.0

- Multi-receiver discovery: group + individual M1S media players.
- Individual M1S players are discovered automatically from Home Assistant media_player
  entities matching `aqara_m1s_zigbee_router`.
- Each Cast target gets its own DIAL port, starting at `dial_port`.
- Shared audio bridge remains on one HTTP port.
- Fast-start playback: the initial yt-dlp metadata lookup no longer blocks playback.
  Metadata is resolved in the background after `play_media` has already been sent.
- Audio process tracking is isolated per receiver, so one receiver does not stop another.
- Per-receiver persistent datastore under `/data`, avoiding the old shared node-persist issue.

Default group target: `media_player.m1s_media_group`.


### Restore individual hub to group after YouTube Stop

With `auto_restore_individual_to_group: true` (default), an individual hub that was in the M1S media group before YouTube / YouTube Music playback is automatically returned to that group when the YouTube session is stopped. If it was already outside the group, it remains outside. The pre-playback membership is remembered once per session so track changes, seeks and interruption resumes do not lose it.

### Stop when the sender app is closed

With `stop_on_implicit_sender_disconnect: true` (default), if the last YouTube / YouTube Music sender disconnects implicitly, playback is stopped after `sender_disconnect_stop_delay_ms` (default 1000 ms). A sender that reconnects during the grace period cancels that Stop. This also uses the normal Stop path, including conditional restore of an individual hub to the M1S media group.
