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
