# M1S YouTube Cast Receiver 1.0.0 — configurare și test

## Cerințe

- Home Assistant cu Supervisor / Apps (add-ons).
- Arhitectură `amd64`.
- Integrarea Aqara M1S care expune `media_player.m1s_media_group` și/sau playerele individuale M1S.
- Telefonul / aplicația YouTube sau YouTube Music trebuie să poată descoperi receiverul DIAL în rețeaua locală.

## Opțiuni

- `target_entity`: media player-ul grupului. Implicit `media_player.m1s_media_group`.
- `device_name`: numele receiverului de grup afișat în Cast. Implicit `Aqara M1S Group`.
- `audio_port`: portul HTTP al fluxului audio continuu. Implicit `8098`.
- `dial_port`: primul port DIAL. Implicit `8099`.
- `stream_host`: IP/host LAN folosit pentru URL-ul audio. Gol = detectare automată.
- `enable_tv_code`: activează pairing-ul manual prin TV code pentru receiverul de grup.
- `include_individual`: creează și receivere pentru M1S individuale.
- `individual_match`: text folosit la identificarea media_player-elor M1S individuale. Implicit `aqara_m1s_zigbee_router`.
- `max_receivers`: numărul maxim de receivere, inclusiv grupul. Implicit `16`.
- `auto_remove_individual_from_group`: scoate temporar un M1S din grup când se face Cast direct pe el.
- `auto_restore_individual_to_group`: restaurează apartenența inițială la grup la Stop real.
- `auto_remove_group_delay_ms`: pauză scurtă după scoaterea playerului individual din grup. Implicit `300 ms`.
- `log_level`: `error`, `warn`, `info` sau `debug`.

## Ce trebuie să vezi la funcționare normală

1. Pornește add-on-ul.
2. În log trebuie să apară receiverele descoperite și pornirea receiverelor DIAL.
3. Din YouTube / YouTube Music alege `Aqara M1S Group` sau un M1S individual.
4. La începutul sesiunii, add-on-ul pornește **un singur transport continuu** în Home Assistant.
5. Lasă să treacă minimum 3 melodii fără să oprești Cast-ul.
6. Melodiile trebuie să ajungă la final și următoarea piesă trebuie să înceapă fără STOP/PLAY și fără un nou buffering al grupului.
7. Testează apoi `Next`, `Seek`, `Pause` și `Resume` din aplicația de pe telefon.
8. Pentru un receiver individual care era în grup, verifică faptul că este scos temporar și restaurat la Stop numai dacă inițial era în grup.

## Semne că arhitectura a fost stricată

- Home Assistant primește alt URL audio la fiecare melodie.
- apare `media_stop` / `play_media` între două melodii consecutive;
- grupul face prebuffer/resync la fiecare piesă;
- integrarea încearcă să decidă când s-a terminat o melodie YTM;
- aceeași melodie pornește din nou după EOF;
- durata raportată este modificată artificial;
- audio este accelerat pentru a „recupera” timpul;
- un endpoint audio răspunde cu 410 doar pentru că piesa fusese marcată ca terminată.

Dacă apare unul dintre aceste comportamente, nu se adaugă un al doilea mecanism de compensare. Se identifică mai întâi stratul care a încălcat regula de bază: **un Cast session = un singur transport HA continuu**.
