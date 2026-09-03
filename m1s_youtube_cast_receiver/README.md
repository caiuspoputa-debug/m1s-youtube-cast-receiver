# M1S YouTube Cast Receiver 1.0.0

Receiver YouTube / YouTube Music pentru Aqara M1S, construit pe un **transport audio continuu**.

## Arhitectură

La începutul unei sesiuni Cast, add-on-ul pornește un singur `play_media` în Home Assistant către un URL de sesiune. Acel URL rămâne deschis între melodii.

```text
YouTube / YouTube Music sender
        ↓
DIAL / Lounge receiver
        ↓
add-on: coadă + yt-dlp + decodare
        ↓
WAV/PCM continuu 32 kHz mono
        ↓
Home Assistant / integrarea M1S
        ↓
M1S individual sau M1S Media Group
```

Schimbarea piesei, EOF-ul piesei, Next, Seek, Pause și Resume sunt gestionate în add-on. Home Assistant nu primește un nou URL și nu trebuie să refacă transportul la fiecare melodie.

## Comportament

- **Start sesiune:** se deschide transportul HA o singură dată.
- **Schimbare melodie:** noul PCM este introdus în același flux.
- **Natural EOF:** add-on-ul cere următoarea piesă din coada Cast și continuă același flux.
- **Seek / Resume:** decoderul piesei este repoziționat în interiorul sesiunii existente.
- **Pause:** sesiunea rămâne proprietatea add-on-ului; transportul nu este reconstruit per-track.
- **Stop real / sfârșit coadă:** sesiunea continuă este închisă.
- **Altă sursă HA:** add-on-ul renunță la ownership fără să oprească sursa nouă.

## Grup și playere individuale

Ținta implicită de grup este `media_player.m1s_media_group`.

Cu `include_individual: true`, add-on-ul descoperă și creează receivere Cast pentru playerele individuale care corespund lui `individual_match`.

Dacă un M1S individual este inclus în grup, `auto_remove_individual_from_group: true` îl scoate temporar înainte de sesiunea directă. La Stop, `auto_restore_individual_to_group: true` îl readuce **doar dacă fusese în grup înainte de sesiune**.

## Principiul care trebuie păstrat

**Add-on-ul este playerul. Integrarea M1S este transportul.**

Nu trebuie introdusă logică per-track în Home Assistant sau în integrarea M1S. Pentru detalii și lista completă „CE NU TREBUIE FĂCUT”, vezi README-ul din rădăcina repository-ului.
