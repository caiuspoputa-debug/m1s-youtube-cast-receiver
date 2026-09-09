## 1.0.3 — Queue navigation, startup state and complete track endings

- Resolve Previous/Next from the explicit ordered video IDs already sent by YouTube/YTM. Previously the default library queried remote TV navigation even when the local list was populated; null endpoints left hasNext false. Keep the sender client, playlist context and index. Remote recommendations are retained only beyond the supplied list when autoplay is enabled; they have a five-second result deadline.
- When HA is playing/buffering the expected source without the optional transport-start serial, immediately use the existing one-time prebuffer estimate. Previously this waited 15 seconds and left the Cast player LOADING while audio was audible; the library rejects Pause in LOADING. Exact serial support and source-ownership checks remain.
- Natural EOF no longer calls library Player.next(), which internally calls stop() on an empty queue. Resolve the successor directly; if absent, wait for queued PCM output and the existing transport lead before STOP. An obsolete EOF cannot stop a newer track in the same session. Explicit Stop and source takeover keep their existing semantics.
- Publish position/state every five seconds while an active session has connected senders, and once on sender reconnect. Do not force PLAYING or publish during startup LOADING; clear the timer on actual Stop.
- Preserve one continuous transport, the existing PCM pacing/buffering, individual/group ownership and same-sender group restore. YouTube playback remains entirely in this add-on. No Home Assistant integration files are included or changed.
- Tests: actual yt-cast-receiver 2.1.0 Playlist navigation with a remote handler returning null, autoplay boundary, startup fallback, serial/source checks, EOF drain, stale completion and progress lifecycle. Tests are synthetic and do not establish that a real phone reconnects or accepts all controls after screen lock.

Installation: replace the add-on source folder from this repository and rebuild/reinstall the add-on so the new JavaScript module is included. Keep the HA integration v0.20.7 (Cast/ICY guard). A normal restart alone does not rebuild a local add-on image. Test a multi-song playlist, screen lock/unlock, Pause/Next/Previous and the complete final song.

# Changelog

## 1.0.2

- Same-sender Individual -> Group handoff: when the same YouTube/YTM sender moves from an individual M1S to `M1S Media Group`, that individual session is stopped and its original group membership is restored before Group playback proceeds.
- The match uses the `yt-cast-receiver` per-sender `Sender.id`; Google/Gaia account ids are deliberately not used, so two phones using the same Google account are not treated as the same sender.
- Individual -> Individual moves do not trigger this automatic restore.
- A different phone starting or controlling another receiver does not stop or restore the first phone's individual session.
- Real Stop keeps the existing 1.0.1 restore behavior. Implicit phone disconnect still keeps playback alive.

## 1.0.1

- Clean stable release based directly on the working `0.3.52` continuous-session runtime.
- Runtime `index.mjs` is unchanged from `0.3.52`.
- `package.json`, Dockerfile, `run.sh`, repository metadata and all add-on options are unchanged from `0.3.52`.
- Only the Home Assistant add-on `version:` is changed to `1.0.1`.
- Documentation now describes only the continuous-session architecture and records the approaches that must not be reintroduced.
