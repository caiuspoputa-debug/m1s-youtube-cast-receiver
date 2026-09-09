## 1.0.6 — Revizie volum telefon: pas 1

Comenzile Cast setVolume venite de pe telefon (YouTube și YouTube Music) modifică volumul cu un singur punct în direcția cerută: de exemplu, o solicitare 6 → 9 aplică 6 → 7. Comenzile rapide sunt procesate succesiv, iar valoarea aplicată este raportată telefonului. Această regulă se aplică comenzilor de volum din telefon, inclusiv selecțiilor absolute trimise de aplicație; protocolul nu distinge aici butoanele de glisorul telefonului. Mute și limitele 0–100 sunt păstrate.

Glisorul și codul integrării Home Assistant nu sunt modificate. Logica de redare este aceeași ca în 1.0.6 YTM-START-FIX. Versiunea rămâne 1.0.6 la cererea utilizatorului: înlocuiește sursele și reconstruiește explicit imaginea, nu doar reporni add-on-ul. Arhiva are sufixul VOLUME-STEP-1.

Testele locale pentru pas, comenzi rapide, mute, limite și volum absolut neprovenit de pe telefon au trecut, împreună cu regresiile de redare. Nu s-a efectuat un test pe telefon/hub sau un build Docker.

## 1.0.6 — Pornire protejată doar pentru YouTube Music

Identifică aplicația din clientul expeditorului (YTMUSIC), inclusiv atunci când mesajele circulă prin sesiunea etichetată YouTube. Doar pentru acești expeditori, pornirile identice împart operația în curs, Play în timpul încărcării așteaptă pornirea existentă, iar selecțiile diferite sunt pornite succesiv. Stop anulează cererile în așteptare. Protecțiile împotriva finalizării unei porniri vechi sunt limitate la modul YTM.

YouTube obișnuit ocolește noua coadă și păstrează comportamentul 1.0.5. Fluxul PCM, sincronizarea, integrarea HA și volumul nu sunt modificate. În sesiuni cu expeditori amestecați, protecția YTM nu se activează automat.

Înlocuiește sursele și reconstruiește imaginea add-on-ului; confirmă versiunea 1.0.6. Testele locale pentru porniri suprapuse, anulare și comportamentul YouTube au trecut. Nu s-a făcut test fizic cu telefonul/hubul sau build Docker. Păstrează arhiva 1.0.5 ca reper.

## 1.0.5 — Cast next/autoplay navigation

- The receiver previously read only the legacy TV autoplay response. Add explicit desktop autoplay, player-overlay autoplay and selected playlist successor parsing, with WEB watch-next fallback when TV returns no endpoint. Retain the original video/playlist/credential context. Do not select arbitrary related videos or invent a replacement playlist. Extend the boundary lookup result deadline from five to twelve seconds; report a missing successor explicitly.
- Include a valid enabled autoplay candidate in the player's advertised hasNext capability. The upstream Playlist.hasNext getter deliberately excludes the final row, even when Playlist.autoplay exists. Send refreshed navigation when the autoplay candidate changes.
- Remove the upstream YouTubeApp setPlaylist pre-stop for a valid replacement. Player.play still owns normal replacement behavior; M1S preserves the established stream. Empty list, explicit Stop and explicit sender-disconnect handling remain intact.
- Apply narrow, source-checked patches to exact yt-cast-receiver 2.1.0 during npm postinstall. The Dockerfile copies patch inputs before dependency installation. An unexpected dependency version or patch target fails the build.
- Regression tests cover the actual patched resolver with controlled TV/WEB responses, exact Playlist autoplay semantics, the actual setPlaylist branch, and all existing transition, seek, queue and final-drain checks. No live authenticated YouTube session, physical phone/hub test or Docker build was performed. Endpoint changes or unavailable remote recommendations can still prevent continuation; this release is not proof that the reported device issue is fully resolved.
- ContinuousSession PCM implementation, HA integration, group restoration and synchronization architecture are unchanged.

## 1.0.4 — Keep Cast state alive during track replacement

- Fix a confirmed intermediate STOPPED notification from the pinned Player.play() implementation. Keeping only doStop() from closing PCM was insufficient: the base stop() still announced STOPPED, including the successor video ID and the previous track's end time. Consume only the synchronous internal replacement stop before the base stop() runs. Explicit Stop remains effective during asynchronous loading and handoff.
- Reset the loading snapshot position/duration for the requested track before the base player publishes it; never associate the successor ID with the preceding track's elapsed time.
- Handle overlapping Play/Seek commands: when seek has already made the target position audible, the library's follow-up resume must not start another decoder for the same position. Normal Pause/Resume and explicit Stop remain available.
- Regression tests use the actual pinned 2.1.0 Player implementation, reproducing the old STOPPED sequence, then checking replacement, natural EOF advance, Stop during loading, overlapping Play/Seek and normal Seek/Pause/Resume. PCM and HA services are mocked; no physical phone/hub test or container build was run.
- ContinuousSession audio code, group restore, queue resolution and final-track drain are unchanged. No Home Assistant integration changes. This release does not claim to fix every RPC reconnect or prove that every phone retains its Cast connection.

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
