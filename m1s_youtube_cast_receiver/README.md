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
