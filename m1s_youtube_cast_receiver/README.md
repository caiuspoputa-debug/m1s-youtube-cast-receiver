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
