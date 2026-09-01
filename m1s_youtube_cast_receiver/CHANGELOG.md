# Changelog

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
