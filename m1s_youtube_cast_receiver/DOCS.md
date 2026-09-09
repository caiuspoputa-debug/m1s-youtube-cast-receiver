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

# Installation and configuration — v1.0.1

Current build architecture: **amd64**.

## Cast targets

The add-on creates:

- one receiver for the configured group target, by default `media_player.m1s_media_group`;
- individual receivers discovered from Home Assistant when `include_individual: true`.

Individual discovery uses `individual_match` against the media player entity id and friendly name. Default: `aqara_m1s_zigbee_router`.

## Ports

- `audio_port`: continuous local audio bridge, default `8098`.
- `dial_port`: first DIAL receiver port, default `8099`.
- additional individual receivers use following DIAL ports.

## Audio behavior

YouTube/YTM opens one continuous Home Assistant transport for the active Cast session. Song boundaries are handled inside the add-on. Home Assistant does not need a new audio URL for every song.

## Individual M1S already in the group

With `auto_remove_individual_from_group: true`, an M1S selected directly can be removed temporarily from the M1S group before playback. With `auto_restore_individual_to_group: true`, it is restored after a real Stop only when it was originally a group member. In v1.0.2, the same restore also runs when the **same sender device** moves from that individual receiver to `M1S Media Group`; this rule applies only to Individual -> Group, never Individual -> Individual, and never to a different sender/phone.

## Options

- `target_entity`: group media player entity.
- `device_name`: group receiver name shown to YouTube/YTM.
- `audio_port`: continuous audio HTTP port.
- `dial_port`: first DIAL port.
- `stream_host`: blank uses automatic LAN IPv4 detection.
- `enable_tv_code`: enable manual TV pairing code for the group receiver.
- `include_individual`: discover individual M1S media players.
- `individual_match`: discovery text for individual players.
- `max_receivers`: maximum number of receivers including the group.
- `resume_interrupted_stream`: preserved 0.3.52 option.
- `resume_interrupted_delay_ms`: preserved 0.3.52 option.
- `auto_remove_individual_from_group`: temporarily remove a directly cast individual from the group when necessary.
- `auto_restore_individual_to_group`: restore original group membership on real Stop.
- `auto_remove_group_delay_ms`: wait after group removal before direct playback.
- `log_level`: `error`, `warn`, `info`, or `debug`.

## First test

1. Start the add-on.
2. Confirm the group and expected individual receivers are discovered in the add-on log.
3. Open YouTube or YouTube Music on the phone.
4. Cast first to the group, then to one individual receiver.
5. Play several consecutive songs and verify that song changes occur without a new HA buffering cycle.

## Architecture rule

Do not add per-track STOP/PLAY, per-track group prebuffer, integration-side YTM EOF detection, artificial duration offsets, audio acceleration, or HTTP 410 replay blocking. The Cast session must remain one continuous HA audio transport.
