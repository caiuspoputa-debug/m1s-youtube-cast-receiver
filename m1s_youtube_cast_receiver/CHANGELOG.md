## 1.0.31 — Pregatirea urmatoarei surse si selectia manuala YouTube

- Pregateste doar informatiile urmatoarei surse in ultimele 30 de secunde,
  folosind intervalul de progres existent. Nu descarca audio in avans si nu
  adauga un buffer PCM. La EOF, pornirea poate reutiliza sursa deja extrasa.
- Selectiile explicite fara listId, cu index numeric 0 sau index omis pastreaza
  piesa ceruta. Nu sunt transformate in golirea playlistului si STOP.
- Selectia manuala porneste fara sa astepte cautarea recomandarilor; raspunsul
  intarziat al navigatiei nu poate reporni o cerere depasita.
- Loguri INFO [CONTROL] compacte arata comenzile si schimbarile de sesiune,
  fara payload-uri integrale, tokenuri, URL-uri sau mesaje periodice noop.
- YouTube primeste din nou piesa si pozitia completa dupa revenirea din fundal;
  reconectarea si actualizarea periodica sunt protejate de generatia sesiunii.
  Nu se emite o stare goala si nu se reporneste redarea pentru resincronizarea UI.

Sursa pregatita foloseste acelasi selector de format si cache-ul existent,
cu anulare, expirare si revenire la extragerea normala in caz de esec.
Coada audio, bufferele, decodarea, ritmul PCM si lead-ul transportului sunt
pastrate. Nu se scurteaza durata si nu se plafoneaza artificial pozitia.

Pastrati integrarea 0.37.21, care a reparat finalul taiat confirmat pe hub.
Publicati sursele add-on-ului si reconstruiti/actualizati imaginea la 1.0.31.
Testele locale si masuratorile reale nu inlocuiesc verificarea pe telefon/hub.

## 1.0.30 — Selectia manuala nu mai primeste STOP de la o cerere veche

Corecteaza un defect reprodus cu Player-ul real: doua selectii suprapuse pot
termina pregatirea in alta ordine. Cererea veche publica STOPPED pentru piesa
noua, desi transportul audio este inca activ. Acest raspuns poate determina
aplicatia sa revina la redarea pe telefon.

O cerere depasita se anuleaza acum la terminarea asteptarilor pentru titlu,
pregatire HA, primul PCM si confirmarea transportului. Nu mai publica stari
pentru piesa noua si nu inchide transportul folosit de aceasta. Stop explicit
anuleaza pregatirea si pentru YouTube obisnuit. Erorile reale ale cererii curente
continua sa fie raportate normal.

Bufferele, decodarea, comenzile yt-dlp/ffmpeg, ritmul PCM, lead-ul si sincronizarea
sunt identice cu 1.0.29. Se pastreaza arhitectura cu un singur flux HA continuu.

IMPORTANT: aceasta versiune remediaza selectia manuala. Taierea audibila a
finalului urmata de pauza NU este confirmata ca rezolvata. Investigatia acesteia
continua cu logurile existente ale integrarii HA, fara compensari de durata.
Publica sursele si reconstruieste/actualizeaza imaginea; confirma 1.0.30.

## 1.0.29 — Trecere automata legata de limita audio

Separarea pregatirii urmatoarei surse de schimbarea piesei in starea Cast:
- La EOF al decodorului se alege urmatoarea piesa fara a muta playlist.current.
- Urmatoarea sursa este decodata din timp prin append in acelasi FIFO, pastrand
  fiecare chunk ramas din piesa veche. Nu se apeleaza Player.play sau HA Play/Stop
  pentru aceasta trecere automata.
- Identitatea, metadata, pozitia si starea Cast se confirma numai dupa prima
  iesire PCM a piesei noi plus lead-ul de transport deja existent.
- Comenzile manuale invalideaza imediat trecerea aflata in pregatire, inclusiv
  inainte de asteptarea raspunsului HA sau a notificarii LOADING din biblioteca.
- Fiecare trecere are context propriu; un callback vechi nu modifica o sesiune noua.
- Piesele foarte scurte ajunse la EOF in timpul tranzitiei continua corect.
- Modificarea listei in timpul pregatirii nu mai poate afisa C peste audio B.

Nu se schimba bufferele, ratele/marimea chunkurilor, ritmul PCM, lead-ul sau
parametrii sincronizarii, argumentele audio yt-dlp/ffmpeg ori fluxul HA continuu.
Nu se adauga offseturi de durata sau timere de final bazate pe durata piesei.
Se pastreaza derularea rapida, anularea corecta, volumul fin, numele si LAN automat.

Testele folosesc Player/Playlist reale din biblioteca si sesiunea PCM, inclusiv
continut audio etichetat pentru verificarea ordinii si pastrarii integrale a cozii.
Verificarea cu surse yt-dlp/ffmpeg reale confirma pastrarea byte-urilor audio;
validarea rezultatului audibil pe hub ramane necesara dupa instalare.
Publica sursele si reconstruieste/actualizeaza imaginea; confirma 1.0.29.
Integrarea Aqara, optiunile si datele persistente raman aceleasi.

## 1.0.28 — Comenzi anulate corect si derulare cu sursa reutilizata

Corecteaza cele doua probleme masurate:
1. Cand Play/Resume/Seek este inlocuit de o comanda noua, sau intervine Pause/Stop,
   asteptarea PCM veche este anulata imediat si nu mai expira dupa15secunde.
   Nu publica PLAYING/STOPPED pentru comanda depasita si nu inchide transportul
   comenzii noi. Un timeout real al sursei curente ramane raportat ca eroare.
2. Prima extragere pastreaza temporar informatiile sursei deja selectate.
   Derularea aceleiasi piese le reutilizeaza prin --load-info-json, pastrand
   formatul si antetele, fara o noua extragere YouTube. Elimina vechile pozitii
   section_start/end inainte de noua derulare. Daca sursa esueaza/expira, este
   invalidata si urmatoarea incercare foloseste extragere proaspata.

Sunt pastrate informatii de sursa, NU un buffer audio nou: maxim8 intrari,
15minute sau pana inaintea expirarii adresei semnate. Fisierele temporare au
acces0600 si sunt eliminate la terminarea incercarii. Nu sunt logate URL-uri.
In log: [TIMING][SOURCE-CACHE] prepared_source=reused/fresh.
Prima pornire a unei piese noi poate necesita in continuare extragerea normala.
Masuratorile suplimentare PIPELINE si remedierea din1.0.27 sunt pastrate.

Bufferele, marimea si ritmul chunkurilor PCM, lead-ul transportului si sincronizarea
nu sunt modificate. Se pastreaza fluxul continuu si avansarea naturala prin append.
Testele includ pastrarea tuturor byte-urilor la finalul piesei si la avansarea
naturala. Raportarea utilizatorului despre un final audibil taiat nu este inca
confirmata ca rezolvata; nu se aplica o compensare de durata sau buffer.

Publica sursele si reconstruieste/actualizeaza imaginea. Confirma1.0.28.
Integrarea Aqara, optiunile si datele persistente raman aceleasi.
Testele locale si reale yt-dlp/ffmpeg au trecut; validarea pe hub ramane necesara.

## 1.0.27 — Reparatie diagnostic care bloca descarcarea

Corecteaza regresia confirmata in logul utilizatorului pentru 1.0.26:
yt-dlp esua cu Errno 6 la deschiderea /dev/stderr, apoi nu exista PCM.
Markerul before_dl este acum scris intr-un fisier temporar normal, unic pentru
fiecare incercare, creat inaintea lansarii sursei si eliminat la terminare.
Markerul literal contine !, evitand interpretarea drept camp de metadata.
Nu se mai redeschide niciun descriptor de proces pentru diagnostic.

Pastreaza masuratorile suplimentare PIPELINE: pregatirea yt-dlp, primele date
audio si primul PCM ffmpeg. Markerul este observat prin polling la 50 ms;
valorile sunt aproximative la acea rezolutie. Daca fisierul temporar nu poate fi
creat, sursa ruleaza fara marker, iar etapele indisponibile apar unknown.
Testele confirma curatarea la inchidere si date audio neschimbate.
A fost rulat si yt-dlp real pe un fisier Opus/webm servit local, comparand iesirea
byte cu byte cu varianta fara marker. Acest test nu inlocuieste validarea pe hub.

Versiunea nu este o simpla redenumire a 1.0.25: pastreaza diagnosticul separat,
cu mecanismul reparat. Parametrii audio, ffmpeg, bufferele si sincronizarea sunt
pastrate, precum si volumul fin, numele si descoperirea LAN automata.
Publica sursele si reconstruieste/actualizeaza imaginea; confirma 1.0.27.
Nu este necesar downgrade sau actualizare a integrarii Aqara.

## 1.0.26 — Timpi separati yt-dlp, date audio si ffmpeg

Adauga [TIMING][PIPELINE] pentru fiecare incercare, corelata prin session,
track si attempt_at. La nivel info se afiseaza:
- ytdlp_spawn_ms / ffmpeg_spawn_ms: lansarea proceselor.
- ytdlp_before_download_ms: de la pornirea sursei pana la hook-ul yt-dlp
  before_dl, dupa extragere si selectia formatului, inaintea descarcarii.
- first_audio_pipe_byte_ms: primele date audio pe stdout-ul yt-dlp.
- download_to_first_byte_ms: intervalul before_dl -> primele date pe pipe.
- first_pcm_ms / pipe_to_pcm_ms: primul PCM si intervalul date audio -> PCM.
- ytdlp_close_ms / ffmpeg_close_ms, cod/signal: terminare normala sau anulare.
Valorile sunt milisecunde. Etapele necunoscute sunt marcate unknown.
Nu se logheaza URL-uri semnate, tokenuri sau continut audio.

La derulare yt-dlp poate folosi intern ffmpeg pentru download-sections;
acest timp ramane in download_to_first_byte_ms. Acesta nu este o masuratoare
pura a retelei, ci timpul pana la prima iesire a downloaderului, incluzand
conectare, descarcare si procesare interna. pipe_to_pcm_ms masoara procesul
ffmpeg exterior existent. Markerul stderr este observat la receptia in Node.
Nu se ruleaza o a doua extragere si nu se schimba formatul sau comenzile audio.
Optiunile yt-dlp adaugate sunt numai --no-simulate si --print-to-file before_dl
cu destinatia /dev/stderr; stdout ramane exclusiv audio.

Redarea, sincronizarea, bufferele, volumul fin, numele si descoperirea LAN sunt
pastrate. Reconstruieste/reinstaleaza imaginea si confirma 1.0.26.
Porneste o piesa, deruleaza o data si trimite logul. Nu este necesar debug.

## 1.0.25 — Masuratori pornire si derulare

Adauga numai diagnostic la nivel info, cu prefix [TIMING].
PLAY: intrarea in doPlay, pregatirea titlului/metadata, asteptarea restaurarii.
START: pregatirea individuala/grup, durata apelului HA play_media, primul PCM,
confirmarea serialului transportului, lead si finalizare/eroare.
SOURCE: pornirea yt-dlp/ffmpeg si timpul pana la primele date decodate.
HTTP/PCM: conectarea clientului HA si prima iesire PCM pentru fiecare generatie.
SEEK: pozitia ceruta, verificarea ownership, sursa lansata, primul PCM,
transport lead si finalizare. In pauza se noteaza paused=true; nu se porneste sursa.
Campurile *_ms sunt milisecunde; etapele START sunt cumulative de la
transport_prepare_at. Etapele SEEK sunt cumulative de la received_by_player_at.
Etichetele session/track permit corelarea sursei cu operatia.
Received_by_player_at este intrarea in playerul add-on-ului, nu momentul atingerii
ecranului. Confirmarea audible este derivata din transport; nu masoara fizic boxa.

Nu schimba awaits, timere, timeouturi, buffere, comenzi HA, decodare sau sincronizare.
Pastreaza volumul fin, numele si descoperirea LAN automata.
Inlocuieste sursele si reconstruieste/reinstaleaza imaginea. Confirma 1.0.25.
Pentru test: porneste o piesa pe hub, deruleaza o data, apoi exporta logul
add-on-ului cu liniile [TIMING] si eventualele erori. Nu necesita debug sau captura.

## 1.0.24 — Volum fin din YouTube / YouTube Music

Comenzile Cast de volum folosesc aceeasi scara ca butoanele cardului HA:
0-0,2%: pas 0,01%; 0,2-1%: pas 0,1%; 1-100%: pas 1%.
La crestere, pragul selecteaza intervalul urmator; la scadere, pe cel inferior.
Exemplu: 2 -> 1 -> 0,9 -> ... -> 0,2 -> 0,19 -> ... -> 0%.
O comanda Cast aplica un singur pas in directia ceruta. Comenzile rapide sunt
procesate succesiv. Se pastreaza mute-ul real din HA, fara unmute automat.
Cereri fractionare sunt citite fara trunchiere, iar volumul initial HA pastreaza
precizia de 0,01 puncte procentuale. Butoanele fizice beneficiaza de regula cand
Android/YT/YTM trimit comenzile lor sesiunii Cast; afisajul aplicatiei poate rotunji.

Redarea, sincronizarea, fluxul PCM, descoperirea LAN automata si numele nu sunt
modificate. Cardurile si integrarea HA nu sunt modificate.
Inlocuieste sursele si reconstruieste/reinstaleaza imaginea. Confirma 1.0.24.
Testele locale au trecut; validarea pe telefon/hub ramane de efectuat.

## 1.0.23 — Diacritice corecte si nume fara IP

Numele generate automat din Home Assistant pastreaza diacriticele romanesti.
Capitalizarea foloseste limite Unicode, astfel incat bucatarie cu diacritice
nu mai produce litere majuscule in interiorul cuvantului. Sunt eliminate
adresele IPv4 valide scrise cu puncte, underscore, spatii sau cratime.
Exemplu: bucătărie 192.168.0.210 -> MP Bucătărie.

Numele personalizate din M1S Cast Names raman prioritare si nu sunt rescrise.
Daca sursa este doar un entity_id fara diacritice, acestea nu sunt inventate:
bucatarie_192_168_0_210 -> MP Bucatarie.
Descoperirea LAN automata din 1.0.22, redarea si sincronizarea sunt pastrate.
Inlocuieste sursele si reconstruieste/reinstaleaza imaginea. Confirma 1.0.23.
Nu este necesara actualizarea integrarii Aqara.

## 1.0.22 — Selectie automata LAN pentru DIAL/SSDP

La fiecare pornire a add-on-ului, interfata si IPv4 pentru descoperire sunt
recalculate din interfetele hostului si ruta IPv4 implicita (/proc/net/route).
Nu exista IP sau nume de interfata fix. Sunt excluse interfetele uzuale Docker,
Home Assistant interne, Tailscale si VPN. Daca exista mai multe rute LAN, se
prefera metrica cea mai mica. Fara ruta implicita se accepta doar o singura
adresa LAN eligibila. Detectia neclara este reincercata pana la 15 verificari;
in lipsa unei selectii sigure, add-on-ul raporteaza eroarea, fara publicare pe
adrese alese arbitrar. Schimbarea retelei in timpul functionarii necesita
repornirea add-on-ului pentru recalculare.

Setarile sunt aplicate automat in memorie, fara scrierea unui IP vechi in
options.json. Logul arata: DIAL/SSDP LAN: <interfata> / <IPv4>.
Redarea si sincronizarea raman neschimbate. Anunturile periodice sunt pastrate.
Inlocuieste sursele si reconstruieste/reinstaleaza imaginea; confirma 1.0.22.
Integrarea Aqara nu necesita actualizare.

## 1.0.21 — DIAL/SSDP numai pe LAN

Descoperirea tuturor receiverelor este limitata explicit la interfata eno1
si adresa 192.168.0.20. Adresele Docker si Tailscale nu mai sunt selectate
pentru anunturi sau raspunsuri SSDP. Aceasta versiune este specifica retelei
utilizatorului; daca interfata sau IP-ul se schimba, restrictia trebuie actualizata.
Anunturile periodice din 1.0.20 sunt pastrate.

Singura modificare in index.mjs este configuratia dial.bindToInterfaces si
bindToAddresses. Redarea, sincronizarea, transportul audio, volumul, coada,
numele, porturile si datele persistente nu sunt modificate.

Inlocuieste sursele si reconstruieste/reinstaleaza imaginea add-on-ului.
Confirma versiunea 1.0.21. Simpla repornire a imaginii vechi nu aplica sursele.
Integrarea Aqara nu necesita actualizare.

## 1.0.20 — Reanuntare pentru descoperirea Cast

Adauga exclusiv in biblioteca DIAL anunturi SSDP repetate la 1, 3 si 7 secunde
si apoi la aproximativ 15 secunde (decalaj initial intre receivere). Telefonul
poate astfel primi din nou anunturile dupa redeschiderea YouTube / YouTube Music.
Raspunsurile M-SEARCH, identitatile, numele si porturile raman neschimbate.
Timerele sunt eliminate inainte de oprirea receiverului.

Codul de redare, fluxul PCM continuu, sincronizarea, volumul, coada si integrarea
Aqara sunt identice cu 1.0.19. Nu este adaugat un receiver Google Cast/mDNS.
Aplicatia si reteaua pot influenta in continuare timpul real de descoperire.

Inlocuieste sursele si reconstruieste/reinstaleaza imaginea add-on-ului.
O simpla repornire a imaginii vechi nu aplica patch-ul. Confirma versiunea
1.0.20 si mesajul de build "periodic SSDP announcements enabled".
Pastreaza optiunile si datele persistente existente; integrarea Aqara nu necesita
actualizare. Verifica de cateva ori inchiderea/redeschiderea YT si YTM.

## 1.0.19 — Coordinator included in individual receivers

- Broaden the default discovery match from `aqara_m1s_zigbee_router` to
  `aqara_m1s_zigbee`, including both the coordinator and routers.
- Treat the former default as a compatibility alias for the broader match and
  migrate the persisted add-on option at startup.
- Add focused tests for the coordinator entity, router entities, unrelated
  media players and user-provided custom filters.
- Keep the naming UI, Ingress fixes and complete audio/Cast path unchanged.

## 1.0.18 — Cast-name page client-script fix

- Replace the path-building regular expression whose escape was consumed by
  the server-side template literal, leaving invalid JavaScript in the browser.
- Add a test that extracts and compiles the actual client script served in the
  HTML page, in addition to the existing page and API route tests.
- Keep the 1.0.17 Ingress path and 1.0.16 port fixes. Audio/Cast behavior is
  unchanged.

## 1.0.17 — Home Assistant Ingress path fix

- Change `ingress_entry` from `/settings` to `settings`, preventing Home
  Assistant from generating a `//settings` URL.
- Normalize duplicate slashes and accept both root and `/settings` routes in
  the settings server, including their API paths.
- Keep the 1.0.16 port separation and leave all audio/Cast behavior unchanged.

## 1.0.16 — Ingress/DIAL port collision fix

- Move the Cast-name Ingress server from port 8100 to 18199. Port 8100 is the
  first individual DIAL receiver when the default DIAL base is 8099; using it
  for both services stopped the entire receiver set with `EADDRINUSE`.
- Add a regression test proving that the Ingress port is outside both the audio
  bridge port and the complete configured DIAL receiver range.
- No playback, PCM, synchronization, queue, volume or Cast-control code changes.

## 1.0.15 — Automatic Cast-name editor

- Add a Home Assistant Ingress page that lists the discovered group and
  individual receivers automatically. The user edits only the friendly name;
  the fixed `MP` prefix and entity association are shown without manual entry.
- Store names in `/data/cast-friendly-names.json` and apply them after an
  add-on restart.
- Migrate any 1.0.14 `individual_friendly_names` values before removing that
  legacy option from the Supervisor configuration.
- Keep the settings HTTP server isolated from the receiver and audio server.
  PLAY, STOP, Pause, Next, queue ownership, continuous PCM transport, volume,
  group restoration and phone synchronization are unchanged from 1.0.14.

## 1.0.14 — Custom Cast names with fixed MP prefix

- Add `individual_friendly_names` to the add-on settings. Each entry maps one
  Home Assistant `media_player` entity to the custom room name entered by the
  user.
- Publish every group and individual DIAL receiver with the fixed `MP` prefix.
  Entering `Living` produces `MP Living`; entering `MP Living` does not duplicate
  the prefix.
- Keep Home Assistant `friendly_name` as the fallback only when no custom name
  was configured for that entity.
- Keep the persistent DIAL identity and reconnection context. No extra SSDP
  refresh loop is added.
- PLAY, STOP, Pause, Next, queue ownership, continuous PCM transport, volume,
  group membership restoration and phone synchronization are unchanged from
  1.0.13.

## 1.0.13 — Icon Home Assistant Apps

Adaugă icon pentru add-on, afișat în Apps / Add-ons din Home Assistant, fără schimbări de funcționare pentru receiver. Structura și comportamentul runtime rămân identice cu 1.0.12.

## 1.0.12 — Per-member mute stays under Home Assistant control

- Cast volume updates change only `volume_level`; the add-on no longer calls `media_player.volume_mute`.
- After a phone volume change, the add-on reads the target entity again and reports Home Assistant's actual mute state back to the sender.
- A member muted from its Home Assistant tile therefore remains muted across Cast startup, track changes, phone volume changes and sender reconnection.
- The one-point phone volume step, YouTube/YTM state bridge, continuous PCM stream, metadata update and synchronization behavior are unchanged.

## 1.0.11 — Home Assistant track metadata

- Publish title, artist and YouTube/YouTube Music channel through the Aqara integration v0.20.8 metadata-only service.
- Delay the update by four seconds after the new track becomes audible; late extractor results correct the same active track afterward.
- Bind every update to the exact continuous-session URL and current generation. Stale, stopped and externally replaced sessions cannot update attributes.
- No media transport service is called. Continuous PCM, synchronization, ordinary YouTube, the YTM sidecar bridge and phone volume step 1 are unchanged.

## 1.0.10 — Buildable YTM sidecar bridge

Fixes two source-matching errors in the 1.0.9 postinstall patch that prevented the Home Assistant add-on image from building. Active-session guards are now matched independent of line breaks, and the player-state function boundary is resolved after the actual function. The validation now inspects the installed, patched receiver code rather than merely checking text in the patch script. Running postinstall twice is supported. Playback behavior remains the 1.0.9 sidecar design; ordinary YouTube, continuous PCM, group restore and phone volume step 1 are unchanged.

## 1.0.9 — YTM sidecar control/state fix (broken build; superseded by 1.0.10)

Built from the working 1.0.7 playback path, not from 1.0.8. The 1.0.8 active-session promotion is removed because it made the generic YouTube lounge session inactive; `setPlaylist` / `play` arriving there were then rejected and YouTube Music could no longer start.

1.0.9 keeps the active playback session exactly as 1.0.7, mirrors player-state messages to the YouTube Music sidecar session, answers YTM sidecar state/navigation requests, and accepts YTM sidecar control messages only when the connected sender set is identified as YouTube Music. Ordinary YouTube remains on the 1.0.7 path. Continuous PCM transport, queue/autoplay, group restore and volume-step-1 are unchanged.

## 1.0.7 — Stare completă pentru YouTube Music

Înregistrează în add-on expeditorii YTM deja recunoscuți de bibliotecă la pornire, chiar dacă evenimentul senderConnect nu a fost emis. Registrul acesta condiționează actualizările periodice de progres. Pentru sesiuni identificate ca YTM, trimite starea completă a piesei, duratei, progresului și navigării, inclusiv în pauză. Respinge instantaneele depășite și nu forțează PLAYING când playerul este oprit.

Păstrează comportamentul YouTube și volumul din telefon cu pas 1. Integrarea Home Assistant și fluxul PCM rămân neschimbate. Înlocuiește sursele și reconstruiește add-on-ul. Testele locale au trecut; această corecție nu confirmă singură rezolvarea tuturor controalelor YTM pe telefon. Nu s-a făcut test live pe hub sau build Docker.

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
