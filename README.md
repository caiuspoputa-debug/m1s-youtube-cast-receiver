## 1.0.31 — Trecere mai rapida si selectie manuala YouTube

Pregateste informatiile urmatoarei surse inainte de final, prin extragere fara
descarcare audio. Redarea reutilizeaza cache-ul existent si revine la extragerea
normala daca pregatirea esueaza. Nu se adauga buffere sau offseturi de timp.

Corecteaza selectiile explicite fara playlist ori cu index numeric 0/omis si
elimina asteptarea recomandarilor inainte de pornirea piesei selectate. INFO
[CONTROL] arata comenzile relevante si schimbarile de sesiune, fara tokenuri
sau payload-uri integrale, daca redarea revine din nou pe telefon.

Dupa deblocarea telefonului, YouTube primeste din nou starea completa cu piesa,
pozitia si volumul curent. Actualizarea UI foloseste fluxul existent, fara comenzi audio.

Pastrati integrarea **0.37.21**. Actualizati numai add-on-ul la **1.0.31**, prin
publicarea surselor si reconstruirea/actualizarea imaginii. Bufferele, decodarea,
ritmul PCM si sincronizarea sunt pastrate. Confirmarea fizica ramane necesara.

## 1.0.30 — Corectie pentru selectia manuala a piesei

O cerere veche de selectare a piesei putea publica STOPPED pentru piesa noua,
desi fluxul catre hub ramanea activ. Cererile depasite se anuleaza acum fara sa
modifice starea sau transportul noii selectii. Include teste cu Player-ul real
pentru titluri/raspunsuri HA intarziate, asteptarea PCM si Stop explicit.

Bufferele, decodarea, ritmul PCM, lead-ul transportului si sincronizarea nu sunt
modificate. Taierea audibila a finalului urmata de pauza ramane in investigatie;
aceasta versiune nu este prezentata drept remediere confirmata a acelui simptom.

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

## 1.0.19 — Descoperire coordinator și routere

Extinde filtrul implicit de la routere la toate entitățile
`aqara_m1s_zigbee`, astfel încât coordinatorul apare împreună cu cele cinci
routere. Setarea veche este migrată automat. Redarea și sincronizarea nu sunt
modificate.

## 1.0.18 — Corecție listă goală în pagina de nume

Corectează eroarea JavaScript care împiedica pagina `M1S Cast Names` să încarce
receiverele. Testarea include acum compilarea scriptului exact servit în HTML.
Ruta Ingress, portul separat și întregul traseu audio rămân neschimbate.

## 1.0.17 — Corecție URL Ingress

Elimină slash-ul inițial din `ingress_entry`, astfel încât Home Assistant să
construiască `/settings`, nu `//settings`. Serverul normalizează suplimentar
slash-urile duplicate și acceptă atât ruta rădăcină, cât și `/settings`.

Porturile corectate în 1.0.16 și întregul traseu audio rămân neschimbate.

## 1.0.16 — Corecție critică port Ingress

Mută pagina `M1S Cast Names` de pe portul `8100` pe `18199`. În 1.0.15,
portul `8100` era ocupat simultan de pagina de nume și de primul receiver
individual DIAL, iar add-on-ul se oprea cu `EADDRINUSE`. Un test nou împiedică
reintroducerea suprapunerii cu porturile audio sau DIAL.

Codul PLAY, sesiunea PCM continuă, sincronizarea, coada, volumul și comenzile
YouTube/YTM nu sunt schimbate.

## 1.0.15 — Nume Cast selectate automat

Adaugă ecranul Home Assistant Ingress `M1S Cast Names`. Grupul și playerele
individuale sunt detectate și afișate automat; utilizatorul schimbă numai
numele după prefixul fix `MP`, fără să copieze ID-uri de entitate. Numele sunt
păstrate în datele persistente ale add-on-ului și se aplică după repornire.

La upgrade, numele configurate în 1.0.14 sunt migrate înainte de eliminarea
opțiunii vechi. Serverul mic pentru setări este separat de traseul audio. PLAY,
STOP, Pause, Next, sesiunea continuă, fluxul PCM, sincronizarea cu telefonul,
coada, volumul și restaurarea grupului rămân neschimbate.

## 1.0.14 — Nume Cast custom cu prefix MP fix

Adaugă în setările add-on-ului lista `individual_friendly_names`. Utilizatorul
introduce entitatea și numele de bază, iar receiverul este publicat în
YouTube/YouTube Music cu prefixul fix `MP`. `device_name` este tratat la fel
pentru grup. În lipsa unei configurări custom, numele Home Assistant rămâne
fallback.

Această versiune modifică numai calcularea etichetelor DIAL și configurația.
PLAY, sesiunea continuă, fluxul PCM, sincronizarea cu telefonul, coada, volumul
și restaurarea grupului sunt păstrate din 1.0.13. Identitatea DIAL persistentă
este păstrată și nu este adăugat trafic SSDP periodic suplimentar.

## 1.0.13 — Icon Home Assistant Apps

Adaugă icon pentru add-on, afișat în Apps / Add-ons din Home Assistant, fără schimbări de funcționare pentru receiver. Structura și comportamentul runtime rămân identice cu 1.0.12.

## 1.0.12 — Mute individual păstrat din Home Assistant

Mute-ul fiecărui membru al grupului rămâne controlat exclusiv din tile-ul media playerului din Home Assistant. Comenzile Cast de volum schimbă numai nivelul, cu pas de 1%, și nu mai apelează serviciul `volume_mute`. După schimbarea nivelului, add-on-ul recitește starea mute reală din Home Assistant.

Integrarea Aqara rămâne la v0.20.8. YouTube, YouTube Music, fluxul PCM, sincronizarea, controalele și metadata rămân pe comportamentul v1.0.11.

## 1.0.11 — Titlul piesei în Home Assistant

Publică titlul, artistul și sursa către integrarea Aqara v0.20.8 la aproximativ patru secunde după ce piesa devine audibilă. Actualizarea conține URL-ul exact al sesiunii active; integrarea o respinge dacă între timp sursa s-a schimbat. Nu execută STOP/PLAY și nu schimbă fluxul PCM, sincronizarea, YouTube, YTM sau volumul cu pas 1.

Necesită instalarea împreună cu integrarea Aqara v0.20.8 și reconstruirea add-on-ului.

## 1.0.10 — YTM sidecar bridge, build fix

This release repairs the two postinstall source matches that made 1.0.9 fail during the Home Assistant image build. It keeps the 1.0.9 YTM bridge design and the working ordinary YouTube path. Rebuild/reinstall the add-on and verify that Home Assistant reports version 1.0.10.

## 1.0.9 — YTM sidecar control/state fix (broken build; superseded)

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

## Actualizare 1.0.5 — Next și continuarea listei

Corectează raportarea Next când există o piesă pentru autoplay, caută continuarea și în răspunsul WEB YouTube dacă răspunsul TV nu oferă una și elimină oprirea preliminară la înlocuirea listei cu o piesă validă. Păstrează corecțiile 1.0.4 pentru timp, derulare și Pauză/Play. Nu generează o listă aleatorie când continuarea nu este disponibilă.

Înlocuiește sursele add-on-ului și reconstruiește/reinstalează imaginea. Confirmă versiunea 1.0.5; simpla repornire nu aplică sursele noi. Patch-urile pentru biblioteca 2.1.0 se aplică automat la instalarea dependențelor. Păstrează integrarea HA și opțiunile actuale. Verifică Next în timpul piesei și trecerea automată la final în YouTube și YTM.

Testele locale au trecut, inclusiv păstrarea comportamentului pentru oprirea explicită. Validarea pe telefon/hub și construirea imaginii Docker nu au fost efectuate aici; continuarea reală depinde de răspunsul YouTube.

## Actualizare 1.0.4 — Tranziții Cast

Corectează oprirea intermediară anunțată telefonului la schimbarea piesei și reluarea redundantă după comenzi Play/Seek suprapuse. Starea de încărcare a piesei noi nu mai conține timpul de final al piesei vechi. Păstrează fluxul PCM continuu și restaurarea grupului. Playerul YouTube rămâne exclusiv în add-on; integrarea HA nu se modifică.

Înlocuiește sursele add-on-ului și reconstruiește/reinstalează imaginea; o simplă repornire nu aplică noul cod. Verifică versiunea 1.0.4. Păstrează configurația existentă. Verificarea pe dispozitive trebuie să includă două piese consecutive în YouTube și YTM, derulare, Pauză/Play și blocarea/deblocarea telefonului. Testele locale au trecut, dar nu confirmă singure comportamentul real al telefonului sau rezolvarea tuturor reconectărilor RPC.

## Actualizare 1.0.3

Arhiva modifică **doar add-on-ul YouTube Cast Receiver**. Integrarea Home Assistant rămâne la v0.20.7.

Corecții: navigare Previous/Next din lista primită de la telefon; eliminarea așteptării inutile de 15 secunde în starea de încărcare; golirea audio pregătit înainte de oprirea ultimei piese; actualizare periodică a progresului și după reconectarea telefonului. Arhitectura cu un singur flux continuu și restaurarea grupului sunt păstrate.

Înlocuiește sursele add-on-ului și reconstruiește/reinstalează add-on-ul pentru includerea codului nou. O simplă repornire a imaginii vechi nu aplică modificările. Păstrează opțiunile existente și testează un playlist, blocarea/deblocarea ecranului, Pauză/Next/Previous și finalul ultimei piese.

Validarea locală a trecut; nu s-a efectuat un test live cu telefonul și huburile. Problemele RPC sau comenzile care nu ajung de la telefon nu pot fi declarate rezolvate doar din testele locale.

# M1S YouTube Cast Receiver — v1.0.2

Home Assistant add-on for casting **YouTube / YouTube Music** to Aqara M1S players, individually or through **M1S Media Group**.

## Stable architecture

The add-on is the YouTube/YTM player. Home Assistant and the M1S integration are only the audio transport.

```text
Phone / YouTube Music
        ↓ Cast / DIAL
M1S YouTube Cast Receiver
        ↓ one continuous audio stream for the whole Cast session
Home Assistant / M1S integration
        ↓ PCM transport
Aqara M1S / M1S Media Group
```

A Cast session opens **one continuous HA audio stream**. When the song changes, the add-on changes the decoded track inside that same stream. Home Assistant does not receive a new per-track URL and does not restart playback for every song.

## What is kept working

- YouTube and YouTube Music Cast/DIAL receiver.
- M1S Media Group receiver.
- Automatically discovered individual Aqara M1S receivers.
- Continuous audio transport across song changes.
- Queue advance handled by the add-on.
- Phone controls such as Next, Seek, Pause and Resume handled without rebuilding the HA transport for each track.
- Stable group buffering/synchronization across a session.
- Direct cast to an individual M1S, including temporary removal from the group when required.
- Exact restoration of individual group membership after a real Stop.
- Same-phone Individual → Group handoff: the individual is stopped/restored before Group playback; other phones and Individual → Individual moves are left untouched.
- Source ownership protection when another Home Assistant source takes over the player.

## Version note

`1.0.2` is based strictly on the working `1.0.1` / `0.3.52` continuous-session runtime. The only runtime addition is sender-aware **Individual → Group** restoration: it matches the same phone by `Sender.id`, stops/restores only that phone's active individual session, and does not touch Individual → Individual moves or sessions owned by another phone.

See [`m1s_youtube_cast_receiver/DOCS.md`](m1s_youtube_cast_receiver/DOCS.md) for installation and settings.

## DO NOT DO THIS

The following approaches caused loops, stutter, cut tracks, timing drift or group desynchronization during development and must not be reintroduced:

1. Do not STOP/PLAY Home Assistant at every song boundary.
2. Do not rebuild or prebuffer the group for every song.
3. Do not make the M1S integration decide YouTube/YTM track EOF or queue Next.
4. Do not treat one track decoder EOF as the end of the whole HA Cast session.
5. Do not add artificial end-of-track timers based on duration/current position.
6. Do not add fake duration offsets such as `+7 seconds`.
7. Do not speed up audio with `atempo` or similar timing compensation.
8. Do not use HTTP 410 / completed-track replay blocking to control normal track progression.
9. Do not move YouTube/YTM queue ownership into the M1S integration.
10. Do not modify receiver-to-hub mapping, source ownership or group restore logic to solve unrelated timing problems.
11. Do not change several timing/transport mechanisms at once while diagnosing one problem.
12. Do not return to a per-track HA transport. **One Cast session = one continuous HA transport.**
