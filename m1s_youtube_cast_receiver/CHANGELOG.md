# Changelog

## 1.0.0

Prima versiune declarată curată/stabilă a arhitecturii YT/YTM cu transport continuu.

- Un singur flux WAV/PCM rămâne deschis pentru întreaga sesiune Cast.
- EOF-ul melodiei, coada și trecerea la următoarea piesă sunt gestionate exclusiv de add-on.
- Home Assistant nu mai primește EOF sau URL nou la fiecare melodie.
- Next, Seek, Pause și Resume sunt gestionate în sesiunea continuă.
- Buffering-ul/sincronizarea HA apar la intrarea în sursa YT/YTM, nu la fiecare piesă.
- Durata raportată este durata reală; nu există compensare `+N` secunde.
- Nu există accelerare audio pentru compensarea timing-ului.
- Nu există blocare HTTP 410 per melodie terminată.
- Ownership-ul sursei și restaurarea exactă a apartenenței playerelor individuale la grup sunt păstrate.
- Documentația `1.0.0` descrie numai arhitectura curentă; istoricul experimental `0.x` rămâne disponibil în istoricul Git.
