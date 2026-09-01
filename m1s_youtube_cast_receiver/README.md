# M1S YouTube Cast Receiver

Home Assistant app/add-on that exposes the Aqara M1S Media Group and the individual
Aqara M1S media players as YouTube / YouTube Music DIAL receivers.

## v0.3.0

- Adds queue-aware playback progression for YouTube / YouTube Music Cast sessions.
- At the end of a track, the add-on now asks the Cast receiver queue for the next item.
  This supports explicit queues, playlists, and YouTube autoplay when the sender provides
  the needed queue context.
- Cast state is kept across implicit sender disconnects, which helps long playback sessions
  continue if the phone sleeps or briefly leaves the network.
- Add-on logs now include queue, playlist, and autoplay mode changes for easier testing.
- Uses `yt-cast-receiver` 2.1.1 for the upstream autoplay queue fix.

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
