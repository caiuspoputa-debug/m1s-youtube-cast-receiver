## 1.0.35 — Diagnostic pentru deconectarea YouTube

Aceasta versiune adauga numai logul INFO `event=sender_presence`. Nu este o
corectie confirmata pentru selectarea unei piese noi in YouTube. Logul real
din 1.0.34 arata o deconectare explicita, dar nu include motivul ei.

Noul eveniment arata motivul `disconnectBehavior`, valoarea si tipul `ui`,
numarul dispozitivelor si daca telefonul cunoscut mai exista in lista primita
si in lista interpretata de receptor. Nu afiseaza ID-uri, tokenuri sau conturi.
Diagnosticul nu modifica dispozitivele primite, deciziile de conectare/oprire,
comenzile, coada, Next sau schimbul de identificare din 1.0.34.

Intregul `index.mjs`, bufferele, transportul PCM si sincronizarea sunt identice
cu 1.0.34. Pastrati integrarea **0.37.21**. Pentru acest diagnostic publicati
sursele si reconstruiti add-on-ul la **1.0.35**.

Dupa reproducere, copiati din log liniile `[M1S-CAST]` din jurul evenimentelor
`sender_presence`, `sender_disconnect` si `player_reset`.

## 1.0.34 — Raspunsul de identificare cerut de YouTube

Raspunde comenzii getDiscoveryDeviceId, observata in log si ignorata anterior.
Mesajul setDiscoveryDeviceId contine identitatea MDX existenta a sesiunii in
campurile discoveryDeviceId si loungeDeviceId. Nu genereaza un ID nou si nu
modifica asocierea sau datele salvate pentru YT/YTM.

Schimbul de identificare este separat pentru fiecare sesiune. Se opreste la
onSetDiscoveryDeviceId, la inchiderea/reinlocuirea sesiunii sau dupa cinci
raspunsuri, la intervale de10secunde. Logul INFO [M1S-CAST] arata cererea,
raspunsul si confirmarea, fara identificatori sau tokenuri.

Aceasta completeaza un schimb de protocol lipsa; efectul asupra selectiei
manuale pe telefon trebuie confirmat. Next si coada functionale in1.0.33 se
pastreaza. Intregul index.mjs de redare, bufferele, PCM si sincronizarea sunt
identice cu1.0.33. Pastrati integrarea **0.37.21** si reconstruiti add-on-ul **1.0.34**.

Referinta verificata este serviciul generic din implementarea oficiala YouTube TV:
https://www.youtube.com/s/_/kabuki/_/js/k=kabuki.base_cr.en_US.G-wN2zlQOe4.es5.O/am=AAAAAEBDAEAhABABNKAgSCg/d=1/excm=main/br=1/rs=ANjRhVkIB_Tk5wvTkdjPDDAN7zbWzxjzKw/m=N5oOV

## 1.0.33 — Confirmari corecte ale comenzilor si pastrarea cozii

Corecteaza contorul de confirmare BrowserChannel: actualizarea starii nu mai
avanseaza numarul ultimului mesaj primit. Fiecare sesiune YT/YTM confirma numai
mesajele primite de ea; o stare transmisa si celeilalte sesiuni nu ii mai poate
modifica acest contor. Numararea mesajelor trimise, RID si reconectarea raman intacte.

Defectul este reprodus cu Session/RPC/BindParams reale: dupa primirea mesajului18,
12 actualizari de stare duceau reconectarea la confirmarea30. Acum ramane18 pana
la primirea unui mesaj nou. Referinta protocolului este implementarea Google:
https://github.com/google/closure-library/blob/master/closure/goog/net/browserchannel.js

Pastreaza lista cunoscuta si pentru setPlaylist fara videoIds, numai daca
listId este acelasi si piesa exista deja in lista. Testul cu101piese pastreaza
urmatorul element si comanda Next dupa selectia manuala, pentru YT si YTM.

Acestea sunt defecte confirmate local. Pierderea legaturii pe telefonul fizic
trebuie reverificata; logul primit nu include comanda din momentul esecului.
Intregul index.mjs de redare este identic cu1.0.32: bufferele, PCM, transportul,
derularea si sincronizarea nu sunt modificate. Pastrati integrarea **0.37.21**.
Publicati sursele si reconstruiti add-on-ul la **1.0.33**.

## 1.0.32 — Selectia YouTube si piesa urmatoare

Trateaza selectia explicita VIDEO_SELECTED transmisa prin updatePlaylist,
inclusiv identificatorul din eventDetails. Nu transforma selectia in STOP.
Cand YouTube omite lista pentru o piesa deja prezenta in acelasi playlist,
pastreaza coada cunoscuta si urmatoarea piesa.

Telefonul primeste imediat navigatia si recomandarea autoplay dupa rezolvarea
cautarii, precum si dupa revenirea din fundal. Nu se anunta o lista goala in
locul unei cautari in curs. Logurile INFO [M1S-CAST] disting comanda primita
de coada rezultata, fara datele private din payload.

Cazurile reproduse sunt testate cu App/Player/Playlist reale pentru YT si YTM.
Verificarea pe telefon/hub ramane necesara. Bufferele, sesiunea PCM, decodarea
si sincronizarea sunt pastrate. Pastrati integrarea **0.37.21** si actualizati
numai add-on-ul la **1.0.32**, publicand sursele si reconstruind imaginea.

## 1.0.31 — Trecere mai rapida si selectie manuala YouTube

Pregateste informatiile urmatoarei surse inainte de final, prin extragere fara
descarcare audio. Redarea reutilizeaza cache-ul existent si revine la extragerea
normala daca pregatirea esueaza. Nu se adauga buffere sau offseturi de timp.

Corecteaza selectiile explicite fara playlist ori cu index numeric 0/omis si
elimina asteptarea recomandarilor inainte de pornirea piesei selectate. INFO
[M1S-CAST] arata comenzile relevante si schimbarile de sesiune, fara tokenuri
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

## 1.0.19 — Coordinator inclus în lista individuală

Filtrul implicit devine `aqara_m1s_zigbee`, astfel încât sunt descoperite atât
coordinatorul, cât și routerele. Valoarea veche
`aqara_m1s_zigbee_router` este migrată automat și este tratată compatibil ca
noul filtru, deci upgrade-ul nu necesită modificări manuale.

Pagina de nume va afișa grupul, coordinatorul și cele cinci routere. Traseul
audio, sincronizarea și comenzile Cast nu sunt modificate.

## 1.0.18 — Corecție încărcare listă huburi

Corectează scriptul paginii `M1S Cast Names`, care se oprea înainte să solicite
lista receiverelor și lăsa panoul gol. Construirea adresei API nu mai folosește
expresia regulată afectată de escaparea HTML. Testele compilează acum chiar
scriptul livrat browserului.

Rămân active corecțiile de rută și port din 1.0.17/1.0.16. Traseul audio și
sincronizarea nu sunt modificate.

## 1.0.17 — Corecție adresă Home Assistant Ingress

Corectează adresa `//settings` generată de Home Assistant în 1.0.16.
`ingress_entry` este acum `settings`, fără slash inițial. Serverul acceptă și
normalizează defensiv ruta rădăcină, `/settings` și slash-urile duplicate.

Portul separat `18199` rămâne neschimbat. PLAY, fluxul PCM, sincronizarea,
coada, volumul și comenzile YouTube/YTM nu sunt modificate.

## 1.0.16 — Corecție port pentru pagina de nume

Corectează oprirea add-on-ului din 1.0.15. Pagina `M1S Cast Names` folosea
portul `8100`, același port alocat primului receiver individual după baza DIAL
`8099`. Serverul paginii este mutat pe `18199`, în afara intervalului audio și
DIAL, iar un test verifică automat această separare.

Redarea, fluxul PCM continuu, sincronizarea, comenzile Cast, coada, volumul și
restaurarea grupului nu sunt modificate.

## 1.0.15 — Listă automată pentru numele Cast

Add-on-ul are acum propriul ecran Home Assistant, `M1S Cast Names`. Acesta
afișează automat grupul și toate receiverele individuale descoperite, împreună
cu entitatea lor. Se modifică numai numele camerei; prefixul `MP` este fix și
vizibil lângă fiecare câmp. Nu mai trebuie copiat niciun `entity_id` din Home
Assistant.

După salvare, repornește add-on-ul pentru ca telefonul să primească noile nume.
La upgrade de la 1.0.14, numele introduse în vechea listă sunt migrate automat,
iar opțiunea veche este eliminată. Dacă nu există un nume salvat, se folosește
în continuare numele găsit în Home Assistant.

Ecranul rulează separat de receiver. PLAY, STOP, Pause, Next, coada, sesiunea
PCM continuă, volumul, apartenența la grup și sincronizarea cu telefonul nu sunt
modificate față de 1.0.14.

## 1.0.14 — Nume Cast custom cu prefix MP fix

În setările add-on-ului, `device_name` stabilește numele de bază al grupului,
iar `individual_friendly_names` permite asocierea fiecărei entități
`media_player` cu un nume custom. Se introduce numai numele, de exemplu
`Living`; add-on-ul îl publică în YouTube și YouTube Music ca `MP Living`.
Prefixul `MP` este adăugat automat și nu este dublat dacă a fost introdus deja.

Dacă o entitate nu are nume custom, rămâne activ fallback-ul bazat pe
`friendly_name` din Home Assistant, tot cu prefixul `MP`. Identitatea DIAL și
contextul de reconectare rămân persistente. Nu s-a adăugat un ciclu agresiv de
anunțuri SSDP. PLAY, fluxul PCM continuu, sincronizarea cu telefonul, coada,
volumul și restaurarea grupului sunt identice cu 1.0.13.

## 1.0.13 — Icon Home Assistant Apps

Adaugă icon pentru add-on, afișat în Apps / Add-ons din Home Assistant, fără schimbări de funcționare pentru receiver. Structura și comportamentul runtime rămân identice cu 1.0.12.

## 1.0.12 — Mute individual păstrat din Home Assistant

Mute-ul fiecărui membru al grupului rămâne controlat exclusiv din tile-ul media playerului din Home Assistant. Comenzile Cast de volum schimbă numai nivelul, în continuare cu pas de 1%, și nu mai pot trimite automat `unmute`. După schimbarea volumului, add-on-ul recitește starea reală de mute din Home Assistant și o raportează telefonului.

Integrarea Aqara rămâne la v0.20.8. Fluxul PCM, sincronizarea, YouTube, YouTube Music, controalele și actualizarea titlului nu sunt schimbate.

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

This add-on exposes the Aqara M1S Media Group and discovered individual Aqara M1S media players as YouTube / YouTube Music Cast/DIAL targets.

## Architecture

The add-on owns YouTube/YTM playback: Cast state, track extraction, queue progression and track changes. Home Assistant receives one continuous audio stream for the Cast session and the M1S integration transports that audio to the hub(s).

**Track change does not mean a new HA playback session.** The next decoded track is fed into the same continuous stream.

This keeps group buffering and synchronization stable in the same way a continuous radio stream does.

## Preserved behavior

- Group and individual Cast targets.
- Continuous session audio.
- Queue progression inside the add-on.
- Phone Next / Seek / Pause / Resume without per-track HA transport restart.
- Automatic temporary removal of an individual M1S from the group when direct playback requires it.
- Restoration to the group only when that M1S was originally in the group.
- Same-phone Individual → Group handoff restores that individual before Group playback; Individual → Individual and other-phone sessions are not altered.
- Protection against stale YouTube commands taking control back from another HA source.

## Important

v1.0.2 preserves the continuous-stream runtime and configuration from v1.0.1. Its only runtime change is same-sender Individual → Group restore, keyed by `Sender.id`; implicit disconnect behavior and multi-phone independence remain unchanged.

See `DOCS.md` for installation/options and the repository root `README.md` for the rules that must not be reintroduced.
