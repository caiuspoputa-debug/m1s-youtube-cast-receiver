# M1S YouTube Cast Receiver — 1.0.0

Add-on Home Assistant pentru redarea **YouTube / YouTube Music** pe hub-uri **Aqara M1S**, individual sau prin `M1S Media Group`.

## Principiul de bază

Versiunea 1.0.0 folosește o singură regulă arhitecturală:

> **Add-on-ul este playerul YouTube/YTM. Home Assistant și integrarea M1S sunt doar transportul audio.**

În timpul unei sesiuni Cast, add-on-ul deschide **un singur flux audio continuu** către Home Assistant. Schimbarea melodiei nu închide acel flux și nu pornește alt `play_media` în Home Assistant.

```text
Telefon / YouTube Music
        ↓ Cast / DIAL
M1S YouTube Cast Receiver
        ↓ un singur flux WAV/PCM continuu
Home Assistant media_player
        ↓ transport PCM
Aqara M1S / M1S Media Group
```

## Ce funcționează în 1.0.0

- YouTube și YouTube Music prin Cast/DIAL.
- Un receiver pentru `M1S Media Group`.
- Receivere individuale pentru hub-urile Aqara M1S descoperite în Home Assistant.
- **O singură sesiune audio HA** pentru întreaga sesiune YT/YTM.
- Melodiile sunt schimbate **în interiorul fluxului continuu**.
- EOF-ul unei melodii și avansarea cozii sunt responsabilitatea add-on-ului.
- `Next`, `Pause`, `Resume` și `Seek` din aplicația YouTube/YTM sunt rezolvate de add-on fără restartarea transportului HA.
- La schimbarea melodiei se schimbă metadatele, nu transportul audio.
- Grupul este pregătit o singură dată la intrarea în sesiunea YT/YTM; nu se face prebuffer la fiecare melodie.
- Pentru un player individual aflat în grup, add-on-ul îl poate scoate temporar din grup înainte de redare.
- La Stop real, playerul individual este reintrodus în grup **numai dacă era în grup înainte de sesiunea YT/YTM**.
- Dacă o altă sursă Home Assistant preia playerul, add-on-ul renunță la ownership și nu oprește noua sursă.
- Audio: WAV/PCM mono, 32 kHz, menținut continuu pe durata sesiunii.

## De ce arhitectura este stabilă

Integrarea M1S nu mai trebuie să știe unde începe sau unde se termină fiecare melodie YouTube Music. Din punctul ei de vedere, YT/YTM se comportă ca un radio: primește un flux continuu și îl livrează către hub-uri.

Astfel, schimbarea melodiei nu mai produce o nouă secvență STOP → PLAY → prebuffer → sincronizare. Bufferul și sincronizarea grupului rămân stabile pe aceeași sesiune audio.

## Instalare

Adaugă repository-ul în Home Assistant și instalează **M1S YouTube Cast Receiver**.

Platforma configurată în prezent: `amd64`.

După pornire, receiverul de grup și receiverele individuale apar ca ținte Cast/DIAL pentru YouTube / YouTube Music.

Documentația opțiunilor și primul test sunt în [`m1s_youtube_cast_receiver/DOCS.md`](m1s_youtube_cast_receiver/DOCS.md).

## Regula proiectului de la 1.0.0 înainte

Orice dezvoltare viitoare trebuie să păstreze separarea responsabilităților:

- **add-on:** YouTube/YTM, Cast, coadă, EOF de melodie, Next, Seek, Pause/Resume, metadate;
- **integrarea M1S:** transport audio către hub/hub-uri și sincronizarea grupului;
- **Home Assistant:** host și API, fără logică de sfârșit de melodie YTM.

## CE NU TREBUIE FĂCUT

Aceste reguli sunt intenționate. Încălcarea lor a produs în versiunile experimentale bâlbâieli, bucle, melodii tăiate și desincronizare.

1. **Nu se face `media_stop` / `play_media` în Home Assistant la fiecare melodie.**
2. **Nu se face prebuffer sau resync de grup la fiecare melodie.** Buffering-ul aparține începutului sesiunii/schimbării reale de sursă.
3. **Integrarea M1S nu trebuie să detecteze EOF-ul fiecărei melodii YTM și nu trebuie să decidă `Next`.**
4. **EOF-ul decoderului unei melodii nu înseamnă EOF-ul sesiunii HA.** Add-on-ul trece la piesa următoare în același flux.
5. **Nu se introduc timere artificiale de final de melodie** pe baza `duration`, `currentPosition` sau a unor estimări de buffer.
6. **Nu se compensează timpul raportat cu +N secunde.** Durata trimisă către sender trebuie să fie durata reală a piesei.
7. **Nu se accelerează audio (`atempo`, resampling pentru viteză etc.) pentru a compensa întârzieri.**
8. **Nu se blochează reluarea unei cereri de piesă cu HTTP 410 sau registre per-track de tip „already completed”.**
9. **Nu se mută logica de coadă YouTube/YTM în integrarea M1S.** Add-on-ul este singura sursă de adevăr pentru player.
10. **Nu se schimbă simultan mai multe mecanisme când se investighează o problemă.** Se modifică o singură responsabilitate și se verifică efectul.
11. **Nu se modifică mapping-ul receiver → hub, ownership-ul sursei sau restaurarea grupului pentru a repara probleme de timing.** Sunt probleme separate.
12. **Nu se reintroduce arhitectura per-track.** Un Cast session = un transport HA continuu.

## Versiune

**1.0.0** este prima versiune declarată curată a arhitecturii cu transport YT/YTM continuu. Versiunile `0.x` au fost faza de dezvoltare și experimentare și nu mai sunt documentate ca arhitectură curentă.
