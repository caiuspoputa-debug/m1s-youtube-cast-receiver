# M1S YouTube Cast Receiver

Home Assistant app/add-on that exposes the Aqara M1S Media Group and the individual
Aqara M1S media players as YouTube / YouTube Music DIAL receivers.

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
