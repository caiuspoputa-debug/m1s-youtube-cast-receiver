[**Română**](README_RO.md) | [English](README.md)

# Aqara M1S Gen 1 — conversie completă în Zigbee Router + integrare Home Assistant

Versiune documentație: **2026-08-09 — v0.5.13 TEST, resincronizare periodică + batch sunete**  
Integrare Home Assistant inclusă: **0.5.13 TEST**  
Model țintă: **Aqara M1S Gen 1 `lumi.gateway.aeu01`**

Acesta este ghidul principal pentru refacerea unui hub stock în configurația folosită de proiect:

- Linux, Wi-Fi, HomeKit și audio stock păstrate;
- Telnet persistent numai în LAN;
- NXP JN5189 convertit în **BDB Zigbee Router**;
- inel RGB și iluminare citite direct prin UART;
- media player individual și grup media în Home Assistant;
- sunete WAV locale administrabile;
- bridge opțional pentru butonul fizic prin MQTT;
- mecanism opțional de recuperare Wi-Fi, fără SSID sau parole incluse în pachet.

Revizia R2 integrează constatările din README-ul GitHub din 2026-08-07: alegerea stock STA/AP pe baza proprietăților Aqara/HomeKit, administrarea completă a sunetelor, comportamentul de disponibilitate și precizările de operare HACS/rejoin.

> **Operație avansată.** Conversia scrie memoria FLASH a JN5189. Nu continua fără două backupuri identice și verificate. Nu scrie niciodată EFUSE, ROM, Config, PSECT sau pFLASH și nu executa erase complet al cipului.

---

## Modificări v0.5.13 TEST — resincronizare periodică

- redarea de grup de lungă durată are acum o resincronizare preventivă a receiverelor la fiecare 10 minute
- mecanismul oprește broadcasterul PCM la limita unui cadru de 20 ms, repornește pe toate huburile active doar lanțul `nc`/`aplay`, aplică din nou lead-in-ul comun de 1,5 secunde și apoi continuă fluxul
- FFmpeg nu este repornit de această resincronizare periodică; pentru fișiere finite redarea nu sare la început, deoarece sursa este ținută pe loc prin back-pressure cât timp receiverele sunt reconstruite
- restarturile complete de siguranță pentru lag persistent, coadă plină, blocaj PCM și revenirea unui hub rămân neschimbate
- batch management-ul de sunete din v0.5.11 rămâne inclus: un WAV sau un ZIP cu până la 64 WAV-uri, plus ștergere multiplă
- aceasta este o versiune TEST deoarece decalajul intermitent trebuie urmărit în timp pe huburile fizice


## Modificări v0.5.13 TEST — administrare sunete în lot

- Configure → Ștergere WAV permite selectarea și ștergerea mai multor fișiere administrate într-o singură operație
- selectorul nativ de fișier Home Assistant primește un singur upload; de aceea Configure acceptă acum fie un WAV, fie un ZIP cu mai multe WAV-uri
- un ZIP poate conține maximum 64 WAV-uri, cu limita existentă de 20 MiB per WAV și maximum 100 MiB total
- ZIP-ul este procesat în memorie; intrările non-WAV sunt ignorate, iar arhivele criptate și numele WAV duplicate sunt refuzate
- toate modificările audio v0.5.10, inclusiv watchdog, diagnosticul `tcp_pcm_backpressure` și Fine Volume Trim, rămân neschimbate

## Modificări v0.5.10 TEST — eliminarea resync-urilor false și diagnostic audio mai precis

- pragul de aproximativ 120 ms al cozii unui hub nu mai provoacă resync la un singur vârf; trebuie să rămână depășit continuu timp de 1,0 secundă
- după fiecare pornire/resync al grupului există 8 secunde de grație în care detecția de lag este suspendată, astfel încât faza normală de pornire a receiverelor să nu declanșeze alt restart
- dacă o coadă ajunge complet plină la 250 ms, sincronizarea este deja compromisă și se face în continuare resync complet imediat
- timeoutul `writer.drain()` pentru PCM/TCP crește de la 1,0 s la 2,0 s atât pentru grup, cât și pentru playerul individual
- timeoutul individual este raportat acum explicit ca `tcp_pcm_backpressure`, nu generic `hub_audio`; snapshotul de diagnostic al hubului se păstrează
- watchdog-ul pe progres PCM, resync-ul complet la revenirea unui hub și Fine Volume Trim din v0.5.9 rămân active

Această versiune rămâne **TEST** până verificăm pe huburile reale: redare de câteva ore, oprire/pornire a unui membru și absența resync-urilor repetate fără motiv.

## Modificări v0.5.9 TEST — reglaj fin individual

- fiecare media player individual primește un al doilea slider **Fine Volume Trim**
- volumul principal rămâne 0–100% cu pas de 0,1%; trim-ul este -1,00% … +1,00% cu pas de 0,01 puncte procentuale
- exemplu: volum principal 6,0% + trim +0,27% = gain PCM efectiv 6,27%
- trim-ul se aplică live pe PCM S32_LE prin aceeași rampă anti-click de 40 ms, fără restart FFmpeg, TCP, `nc` sau `aplay`
- volum principal 0% rămâne tăcere completă chiar dacă trim-ul este pozitiv; mute rămâne de asemenea tăcere completă
- logica de sincronizare și watchdog introdusă în v0.5.8 rămâne neschimbată

## Modificări v0.5.8 TEST — sincronizare și redare de lungă durată

- sincronizarea are prioritate față de continuitate: dacă un hub revine sau acumulează latență, grupul este întrerupt scurt și repornit complet
- un hub revenit online primește 8 secunde pentru stabilizare înainte de resynchronizare
- coada PCM per hub este limitată la 250 ms; la aproximativ 120 ms de coadă se cere resync complet, în loc să fie acceptată redarea întârziată
- broadcasterul cedează event loop-ul după fiecare chunk PCM de 20 ms, astfel încât writer-ele huburilor să poată goli cozile în timp real
- un watchdog nou urmărește progresul PCM, nu doar existența procesului FFmpeg; dacă nu apare PCM timp de 12 secunde, întregul grup este repornit
- starea „stabil” este acceptată numai când PCM-ul curge efectiv și există cel puțin un receiver activ

Această versiune este intenționat **TEST** până la validarea pe huburi reale a scenariilor: oprire/pornire hub în timpul redării și redare continuă de mai multe ore.

---

## 1. Ce este „curent” și ce este doar istoric

Folosește pentru o instalare nouă numai următoarele componente:

| Componentă | Versiune/fișier curent | Rol |
|---|---|---|
| Integrare Home Assistant | `custom_components/aqara_m1s_zigbee_router`, manifest `0.5.13` | control local, senzori, audio, grup, diagnostic și schimbare Wi-Fi sigură |
| Firmware JN5189 | `jn5189_router_rgb_lux_rejoin_test.bin` | Zigbee Router, RGB, lux PIO19/ADC5, comandă rejoin A7 |
| Boot persistent | `scripts/hub/post_init.sh` | servicii stock, Telnet, UART liber, boot Router |
| Diagnostic boot Wi-Fi stock | `scripts/hub/aqara_wifi_boot_state.sh` | verifică și, la cerere, corectează stările Aqara care aleg STA sau AP |
| Programare JN5189 | `scripts/hub/jn5189_*.sh` și `scripts/windows/JN5189-*.ps1` | preflight, ISP, backup, flash și readback |
| Recuperare Wi-Fi | `installers/m1s_wifi_recovery_SANITIZED.tgz` | opțional; pornește AP după lipsă IP |
| Buton fizic MQTT | `installers/m1s_button_bridge_SANITIZED.tgz` | opțional; publică gesturile butonului |

Folderele și README-urile versiunilor 0.1.x–0.5.5 au fost folosite pentru reconstruirea istoricului, dar nu trebuie amestecate cu procedura curentă. Vezi [auditul complet](docs/AUDIT_README_SI_SCRIPTURI.md) și [raportul de validare](docs/VALIDATION_REPORT.md).

### Hash firmware curent

```text
Fișier: jn5189_router_rgb_lux_rejoin_test.bin
Dimensiune: 209296 bytes (0x33190)
SHA256: a1a1f302be9e3ab95fd6a3b8f4ac260e1f397fec275fb3e3caf8418cd75e7a2f
Zona aplicației rotunjită la sector: 0x33200
Memory ID: 0 / FLASH
```

Verificare în PowerShell:

```powershell
Get-Item .\jn5189_router_rgb_lux_rejoin_test.bin
Get-FileHash .\jn5189_router_rgb_lux_rejoin_test.bin -Algorithm SHA256
```

Oprește procedura dacă dimensiunea sau SHA256 diferă. Buildul istoric `jn5189_router_rgb_lux_no_switch.bin` nu a demonstrat eliminarea serverului On/Off și **nu se folosește** la o conversie nouă. Numele unui binar nu este dovadă de identitate; folosește numai fișierul și hashul de mai sus.

După extragerea întregului kit, verifică toate fișierele din PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\Verify-Kit.ps1
```

Rezultatul corect se termină cu `KIT_SHA256_OK`. Lista `SHA256SUMS.txt` nu se include pe ea însăși în calcul.

---

## 2. Starea de validare

Separă clar ce provine din configurația fizic folosită și ce a fost standardizat în acest kit:

### Confirmat în istoricul proiectului

- modelul `lumi.gateway.aeu01` și firmware stock de pregătire `3.1.3_0009`;
- Linux MIPS, kernel 3.10.90, BusyBox 1.22.1;
- JN5189 pe `/dev/ttyS1`, 115200 8N1;
- GPIO18 reset, activ la `1`;
- GPIO33: ISP=`0`, boot normal=`1`;
- programare prin SPSDK și `socket://HUB_IP:1888`;
- backup FLASH Memory ID 0 de 646656 bytes (`0x9DE00`);
- firmware-ul curent scris cu succes și revenirea Routerului în Zigbee2MQTT;
- bootul persistent de bază, RGB, lux, audio și integrarea Home Assistant.

### Standardizat în această revizie

- README master reorganizat pentru o instalare de la zero;
- scripturi separate pentru preflight, ISP, boot, verificare și PowerShell;
- readback SHA256 obligatoriu după flash;
- script separat pentru diagnosticul și corectarea stărilor stock care aleg STA/AP, fără citirea SSID-ului sau parolei;
- installer Wi-Fi fără credențiale incluse, care preia datele existente numai local de pe hub;
- pachet separat pentru bridge-ul butonului fizic, fără broker/username/parolă incluse;
- inventar de porturi, pași de acceptare și proceduri de recuperare.

Scripturile nou standardizate au fost verificate static și ca arhive, dar recuperarea Wi-Fi și bridge-ul butonului trebuie reverificate fizic pe un hub de test înainte de copierea pe toate huburile.

---

## 3. Cerințe

### Hardware

- Aqara M1S Gen 1, model exact `lumi.gateway.aeu01`;
- rețea Wi-Fi 2,4 GHz;
- router cu rezervare DHCP;
- coordinator Zigbee2MQTT cu Permit join disponibil;
- PC Windows în aceeași rețea;
- Home Assistant cu acces la HACS sau la `/config/custom_components`.

### Software pe Windows

- PowerShell 5.1 sau PowerShell 7;
- Python 3;
- `python-miio` pentru verificarea tokenului;
- SPSDK cu aplicația `dk6prog`;
- client Telnet Windows sau PuTTY.

Instalare:

```powershell
python --version
python -m pip install python-miio
python -m pip install "spsdk[dk6]"
python -m spsdk.apps.dk6prog --help
```

### Reguli de rețea

1. Rezervă un IP fix prin DHCP înainte de conversie.
2. Nu expune prin port forwarding Telnet sau porturile proiectului.
3. PC-ul, Home Assistant și hubul trebuie să fie în LAN-ul de încredere.
4. Ultimul octet al IP-ului este folosit de topicul butonului: `m1s/<octet>/button/action`; schimbarea IP-ului rupe asocierea până la actualizarea integrării.

---

## 4. Structura kitului

```text
Aqara_M1S_Complete_Kit_v0.5.7_FINAL/
├── README_RO.md
├── CHANGELOG.md
├── custom_components/aqara_m1s_zigbee_router/
├── jn5189_router_rgb_lux_rejoin_test.bin
├── scripts/
│   ├── hub/
│   │   ├── post_init.sh
│   │   ├── aqara_wifi_boot_state.sh
│   │   ├── install_post_init.sh
│   │   ├── jn5189_preflight.sh
│   │   ├── jn5189_enter_isp_1888.sh
│   │   ├── jn5189_close_isp_1888.sh
│   │   ├── jn5189_boot_router.sh
│   │   └── verify_hub.sh
│   └── windows/
│       ├── Send-FileToM1S.ps1
│       ├── Receive-FileFromM1S.ps1
│       ├── Verify-Kit.ps1
│       ├── JN5189-Backup.ps1
│       └── JN5189-Flash-Verify.ps1
├── installers/
│   ├── m1s_wifi_recovery_SANITIZED.tgz
│   └── m1s_button_bridge_SANITIZED.tgz
├── SHA256SUMS.txt
└── docs/
    ├── AUDIT_README_SI_SCRIPTURI.md
    ├── INVENTAR_README.md
    ├── VALIDATION_REPORT.md
    ├── COMPARATIE_README_GITHUB_2026-08-07.md
    ├── README_RO_ORIGINAL_v0.5.6.md
    └── README_EN_ORIGINAL_v0.5.6.md
```

Nu copia pe hub întregul repository Home Assistant. Pe hub ajung numai scripturile/pachetele indicate; integrarea se instalează în Home Assistant.

---

# PARTEA I — Pregătirea hubului stock

## 5. Etapa 0 — Fișa hubului și punctele de oprire

Înainte de orice comandă, notează separat pentru fiecare hub:

```text
Nume hub:
Model:
IP rezervat:
MAC Wi-Fi:
Firmware stock:
Token MiIO salvat în manager de parole:
Data backupului JN5189:
SHA256 backup 1:
SHA256 backup 2:
SHA256 firmware scris:
Rezultat readback:
Numele dispozitivului în Zigbee2MQTT:
Numele intrării Home Assistant:
```

### Oprește procedura dacă

- modelul nu este `lumi.gateway.aeu01`;
- IP-ul nu este rezervat;
- Telnet cade sau rețeaua este instabilă;
- SPSDK nu detectează `JN5189`;
- backupul nu are exact 646656 bytes;
- cele două backupuri stock au SHA256 diferit;
- firmware-ul nu are dimensiunea și SHA256 documentate;
- readbackul după scriere diferă de firmware;
- există încă un proces real `cat /dev/ttyS1` sau `mzigbee_agent` înainte de ISP.

Nu folosi reboot ca „test” între erase și write.

---

## 6. Etapa 1 — Adăugare în Xiaomi Home

1. Resetează hubul sau pune-l în modul de asociere.
2. Apasă de două ori butonul pentru trecerea din modul Aqara în Xiaomi/Mi Home.
3. Adaugă-l în Xiaomi Home pe Wi-Fi 2,4 GHz.
4. Folosește regiunea corectă a contului.
5. Confirmă că hubul este online și funcțional stock.
6. Creează rezervarea DHCP și verifică IP-ul după un restart normal.

Apăsarea dublă pentru ecosistem nu este secvența de activare Telnet.

---

## 7. Etapa 2 — Obținerea și verificarea tokenului MiIO

Metoda folosită în proiect:

1. Instalează **Xiaomi Gateway 3** de la AlexxIT prin HACS.
2. Autentifică integrarea cu același cont și aceeași regiune Xiaomi.
3. Găsește `lumi.gateway.aeu01` și copiază tokenul MiIO.
4. Păstrează tokenul ca parolă; nu îl introduce în README, scripturi sau arhive.

Un token valid are 32 de caractere hexazecimale.

```powershell
python -m miio.cli device --ip HUB_IP --token MIIO_TOKEN info
```

Comanda trebuie să răspundă cu informațiile dispozitivului. Nu continua cu un token neverificat.

---

## 8. Etapa 3 — Telnet temporar

Secvența fizică documentată pentru firmware stock compatibil:

```text
5-2-2-2-2-2-2
```

Conectare:

```powershell
telnet HUB_IP
```

În configurația documentată s-a folosit `admin` cu parolă goală; alternativ `root` cu parolă goală.

Metoda MiIO folosită istoric pentru activarea temporară Telnet este:

```powershell
python -m miio.cli device --ip HUB_IP --token MIIO_TOKEN raw_command set_ip_info '{"ssid":"\"\"","pswd":"123123 ; passwd -d admin ; passwd -d root ; telnetd"}'
```

Această comandă modifică temporar accesul administrativ. Ruleaz-o numai în LAN și nu o salva împreună cu tokenul real.

### Verificare inițială pe hub

```sh
uname -a
busybox | head -n 1
getprop ro.product.model
ifconfig wlan0
ps w | grep -E '[m]zigbee_agent|[a]pp_monitor|[m]ha_master'
ls -l /dev/ttyS1
```

Rezultatul trebuie să corespundă modelului și arhitecturii documentate.

---

## 9. Transfer de fișiere între Windows și hub

Metoda simplă folosește un listener BusyBox `nc` pentru o singură conexiune. Portul exemplu este `12345` și trebuie să rămână numai în LAN.

### Hub — primește un fișier

```sh
rm -f /tmp/post_init.sh
nc -l -p 12345 > /tmp/post_init.sh
```

Comanda rămâne blocată până când Windows trimite fișierul.

### Windows — trimite fișierul

Din rădăcina kitului:

```powershell
.\scripts\windows\Send-FileToM1S.ps1 `
  -HubIp HUB_IP `
  -Path .\scripts\hub\post_init.sh `
  -Port 12345
```

### Hub — validează ce a primit

```sh
ls -l /tmp/post_init.sh
/bin/sh -n /tmp/post_init.sh
echo "syntax=$?"
busybox sha256sum /tmp/post_init.sh 2>/dev/null || true
```

Așteaptă `syntax=0`. Repetă aceeași metodă pentru celelalte scripturi sau pachete, schimbând numele destinației.

## 9A. Etapa 3A — Verificarea alegerii stock STA/AP

Această verificare este **separată** de modulul opțional de recuperare Wi-Fi. Firmware-ul Aqara decide la boot dacă pornește în STA sau AP din următoarele trei proprietăți:

```text
persist.app.cloud_provisioned
persist.app.hap_provisioned
persist.app.hap_keepalive
```

Dacă toate trei sunt `false` sau goale, `fw_manager.sh -r` poate porni intenționat `wifi_start.sh AP`, chiar dacă SSID-ul și parola sunt încă salvate. `persist.app.user_paired=true` și existența backupului local Wi-Fi nu schimbă această decizie.

Transferă scriptul fără secrete:

Pe hub:

```sh
rm -f /tmp/aqara_wifi_boot_state.sh
nc -l -p 12345 > /tmp/aqara_wifi_boot_state.sh
```

În Windows:

```powershell
.\scripts\windows\Send-FileToM1S.ps1 `
  -HubIp HUB_IP `
  -Path .\scripts\hub\aqara_wifi_boot_state.sh `
  -Port 12345
```

Pe hub:

```sh
chmod 700 /tmp/aqara_wifi_boot_state.sh
/bin/sh -n /tmp/aqara_wifi_boot_state.sh
/tmp/aqara_wifi_boot_state.sh check
echo "rc=$?"
```

Rezultate:

- `BOOT_WIFI_SELECTION=STA_EXPECTED` — cel puțin una dintre cele trei stări este `true`;
- `BOOT_WIFI_SELECTION=AP_RISK` și `rc=1` — toate trei sunt inactive; corectează înainte de primul reboot.

Corecție validată:

```sh
/tmp/aqara_wifi_boot_state.sh fix
/tmp/aqara_wifi_boot_state.sh check
```

Rezultatul final trebuie să conțină:

```text
cloud_provisioned=true
hap_provisioned=true
hap_keepalive=true
user_paired=true
BOOT_WIFI_SELECTION=STA_EXPECTED
```

Scriptul nu citește și nu afișează SSID-ul, parola Wi-Fi sau tokenul MiIO. Echivalentul manual este `setprop ... true` pentru cele patru proprietăți urmat de `sync`.

> **Critic:** `fw_manager.sh -r` înseamnă pornire normală a serviciilor. `fw_manager.sh -f -r` declanșează calea de factory reset și nu trebuie pus în `post_init.sh`.

---

# PARTEA II — Boot persistent și backupul original

## 10. Etapa 4 — Instalarea `post_init.sh`

Înainte de instalare, etapa 9A trebuie să arate `STA_EXPECTED`. `post_init.sh` doar înregistrează un avertisment dacă stările devin din nou inactive; nu le modifică automat la fiecare boot.

`post_init.sh` curent face următoarele la fiecare boot Linux:

1. pornește serviciile stock prin `fw_manager.sh -r` — pornire normală, fără opțiunea `-f`;
2. așteaptă Wi-Fi;
3. solicită Telnet persistent prin `fw_manager.sh -t -k`;
4. pornește opțional managerul Wi-Fi și portalul, dacă au fost instalate;
5. suspendă `app_monitor`, pentru a nu reporni agentul Zigbee stock;
6. oprește `mzigbee_agent` și orice `cat /dev/ttyS1` rămas;
7. configurează UART-ul la 115200;
8. pornește JN5189 normal, GPIO33=`1`, reset GPIO18 `1 -> 0`;
9. pornește opțional bridge-ul butonului, dacă este configurat;
10. stinge inelul după 10 secunde.

După transferul fișierelor `post_init.sh` și `install_post_init.sh` în `/tmp`:

```sh
chmod 700 /tmp/install_post_init.sh
/bin/sh -n /tmp/install_post_init.sh
/tmp/install_post_init.sh /tmp/post_init.sh
```

Verifică:

```sh
ls -l /data/scripts/post_init.sh
/bin/sh -n /data/scripts/post_init.sh
grep -n 'fw_manager\|mzigbee_agent\|gpio33\|button_watch' /data/scripts/post_init.sh
```

Nu reporni încă hubul. Mai întâi efectuează backupul JN5189.

> În huburile proiectului, `/data/scripts/post_init.sh` este hookul persistent folosit la boot. După primul reboot verifică obligatoriu `/tmp/post_init.log`; existența fișierului în `/data` nu este suficientă pentru a demonstra că a fost executat.

---

## 11. Etapa 5 — Eliberarea UART-ului înainte de ISP

Dacă hubul a fost deja adăugat în integrarea Home Assistant, dezactivează temporar intrarea sau oprește Home Assistant. Integrarea poate recrea automat tunelul UART și un proces `cat /dev/ttyS1`.

Transferă și rulează preflightul:

```sh
chmod 700 /tmp/jn5189_preflight.sh
/tmp/jn5189_preflight.sh
```

Starea corectă înainte de ISP:

- niciun `cat /dev/ttyS1` real;
- `mzigbee_agent` poate fi oprit;
- `app_monitor` poate fi suspendat în starea `T`;
- portul 1888 liber;
- numai sesiunea Telnet folosită pentru intervenție.

Pentru identificarea părintelui unui proces care reapare:

```sh
for p in $(ps w | grep '[c]at /dev/ttyS1' | awk '{print $1}'); do
  echo "CAT=$p"
  grep PPid /proc/$p/status
 done
```

Nu folosi `killall nc`; hubul poate avea tuneluri audio sau UART legitime.

---

## 12. Etapa 6 — Intrarea JN5189 în ISP

Transferă `scripts/hub/jn5189_enter_isp_1888.sh` în `/tmp`, apoi:

```sh
chmod 700 /tmp/jn5189_enter_isp_1888.sh
/bin/sh -n /tmp/jn5189_enter_isp_1888.sh
/tmp/jn5189_enter_isp_1888.sh
```

Rezultatul așteptat:

```text
ISP_LISTENER_OK port=1888 ...
GPIO33=0 GPIO18=0
```

Verificare suplimentară:

```sh
netstat -lnt | grep 1888
ps w | grep '[n]c -l -p 1888'
```

Scriptul folosește o buclă care recreează listenerul după fiecare conexiune SPSDK. Așteaptă aproximativ două secunde între comenzile SPSDK.

### Verificare din Windows

```powershell
python -m spsdk.apps.dk6prog `
  -b PYSERIAL `
  -d "socket://HUB_IP:1888" `
  -n info
```

Trebuie să apară:

```text
Detected DEVICE: JN5189
FLASH  Memory ID 0  Base 0x0  Length 0x9DE00  Sector 0x200
```

Oprește-te dacă dispozitivul sau geometria memoriei diferă.

---

## 13. Etapa 7 — Două backupuri stock identice

Din PowerShell, rulează de două ori scriptul de backup:

```powershell
.\scripts\windows\JN5189-Backup.ps1 -HubIp HUB_IP
Start-Sleep -Seconds 3
.\scripts\windows\JN5189-Backup.ps1 -HubIp HUB_IP
```

Fiecare fișier trebuie să aibă:

```text
646656 bytes
```

Compară hashurile celor mai recente două fișiere:

```powershell
Get-ChildItem .\m1s-backups\*.bin |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 2 |
  ForEach-Object {
    [pscustomobject]@{
      File = $_.FullName
      Bytes = $_.Length
      SHA256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    }
  }
```

Condiția de continuare este:

- ambele au 646656 bytes;
- SHA256 este identic;
- fișierele sunt copiate în minimum două locații fizice diferite;
- numele conține IP-ul/identitatea hubului; backupurile huburilor nu se amestecă.

Backupul poate conține date specifice dispozitivului. Nu îl publica.

---

# PARTEA III — Scrierea firmware-ului Router

## 14. Etapa 8 — Alegerea între update și prima conversie

### Hub deja Router, actualizare de firmware

Nu folosi erase. Scrierea directă a imaginii a păstrat contextul Zigbee în testul documentat.

### Hub stock, prima conversie

Folosește `-EraseApplication`, care șterge numai zona aplicației `0x0–0x33200`, apoi scrie imaginea. Nu șterge întregul cip.

### Verificare simulată PowerShell

```powershell
.\scripts\windows\JN5189-Flash-Verify.ps1 `
  -HubIp HUB_IP `
  -FirmwarePath .\jn5189_router_rgb_lux_rejoin_test.bin `
  -EraseApplication `
  -WhatIf
```

`-WhatIf` nu scrie nimic. Verifică IP-ul, calea și hashul afișat.

---

## 15. Etapa 9 — Flash și readback obligatoriu

### Prima conversie stock

```powershell
.\scripts\windows\JN5189-Flash-Verify.ps1 `
  -HubIp HUB_IP `
  -FirmwarePath .\jn5189_router_rgb_lux_rejoin_test.bin `
  -EraseApplication
```

### Actualizare a unui Router existent

```powershell
.\scripts\windows\JN5189-Flash-Verify.ps1 `
  -HubIp HUB_IP `
  -FirmwarePath .\jn5189_router_rgb_lux_rejoin_test.bin
```

Scriptul:

1. verifică dimensiunea și SHA256 ale firmware-ului;
2. rulează `info`;
3. opțional șterge numai `0x33200` bytes din Memory ID 0;
4. scrie la adresa `0x0`;
5. citește înapoi exact 209296 bytes;
6. compară SHA256 firmware/readback;
7. se oprește cu eroare dacă există orice diferență.

Confirmarea finală trebuie să indice același SHA256 pentru firmware și readback.

Nu trece la boot dacă readbackul diferă.

### Comenzi SPSDK echivalente, pentru depanare

```powershell
# Info
python -m spsdk.apps.dk6prog -b PYSERIAL -d "socket://HUB_IP:1888" -n info

# Erase numai la prima conversie/recuperare
python -m spsdk.apps.dk6prog -b PYSERIAL -d "socket://HUB_IP:1888" -n erase 0x0 0x33200 0

# Write
python -m spsdk.apps.dk6prog -b PYSERIAL -d "socket://HUB_IP:1888" -n write 0x0 ".\jn5189_router_rgb_lux_rejoin_test.bin" 0

# Readback exact
python -m spsdk.apps.dk6prog -b PYSERIAL -d "socket://HUB_IP:1888" -n read -o ".\readback.bin" 0x0 209296 0
```

În SPSDK 3.10.0, `erase` folosește argumente poziționale; forma `--memory-id` nu este acceptată.

---

## 16. Etapa 10 — Închiderea ISP și bootul Routerului

Transferă scripturile de închidere și boot, apoi:

```sh
chmod 700 /tmp/jn5189_close_isp_1888.sh /tmp/jn5189_boot_router.sh
/tmp/jn5189_close_isp_1888.sh
netstat -lnt | grep 1888
```

Ultima comandă nu trebuie să afișeze nimic.

În Zigbee2MQTT activează **Permit join (All)**, apoi:

```sh
/tmp/jn5189_boot_router.sh
```

Rezultatul așteptat:

```text
ROUTER_BOOT_SENT GPIO33=1 GPIO18=0
```

Așteaptă 30–60 de secunde. În Zigbee2MQTT trebuie să apară dispozitivul Lumi/NXP `BDB-Router` cu rol Router.

### Dacă nu apare

1. confirmă Permit join;
2. confirmă GPIO33=`1`, GPIO18=`0`;
3. confirmă că `mzigbee_agent` și `cat /dev/ttyS1` nu rulează;
4. repornește o singură dată Zigbee2MQTT;
5. pulsează din nou resetul prin `jn5189_boot_router.sh`;
6. nu repeta erase/write fără un motiv demonstrat.

---

## 17. Etapa 11 — Primul reboot complet

După ce Routerul este online și readbackul a fost salvat:

```sh
sync
reboot
```

Așteaptă minimum 45 de secunde, reconectează Telnet și rulează `verify_hub.sh`:

```sh
chmod 700 /tmp/verify_hub.sh
/tmp/verify_hub.sh
```

Criterii de acceptare:

- `/tmp/post_init.log` există și conține pornirea JN5189;
- Telnet rulează;
- `app_monitor` este suspendat (`T`);
- `mzigbee_agent` este absent sau numai zombie;
- GPIO33=`1`, GPIO18=`0`;
- Routerul reapare în Zigbee2MQTT după reboot;
- inelul roșu de boot se stinge după întârzierea finală;
- Wi-Fi păstrează IP-ul rezervat.

Nu instala Home Assistant înainte ca această etapă să fie stabilă.

---

# PARTEA IV — Protocoalele locale

## 18. RGB, lux și rejoin

### RGB

```text
A5 RED GREEN BLUE CHECKSUM
CHECKSUM = A5 XOR RED XOR GREEN XOR BLUE
```

Test OFF:

```sh
printf '\245\000\000\000\245' > /dev/ttyS1
```

### Lux

```text
Cerere:  A6 00 00 00 A6
Răspuns: A6 RAW_H RAW_L MV_H MV_L LUX_H LUX_L CHECKSUM
```

Checksumul răspunsului este XOR-ul primilor șapte bytes. Firmware-ul curent folosește PIO19/ADC5.

### Rejoin A7

```text
Cerere:     A7 52 4A 4E F1
Confirmare: A7 4F 4B 00 A3
```

Înainte de rejoin, activează **Permit join** pe coordonatorul destinație. În Home Assistant deschide:

**Setări → Dispozitive și servicii → Aqara M1S Zigbee Router → Configurează → Conectare la alt coordonator Zigbee**

Citește avertismentul și confirmă. Acțiunea șterge numai contextul persistent al rețelei Zigbee din JN5189 și pornește Network Steering. Nu șterge Linux, Wi-Fi, RGB/lux sau sunetele. Coordonatorul vechi poate păstra o intrare rămasă; elimin-o numai după ce Routerul apare online pe coordonatorul nou.

Nu lăsa un `cat /dev/ttyS1` manual după teste; integrarea își administrează singură tunelul UART.

---

# PARTEA V — Home Assistant

## 19. Etapa 12 — Instalarea integrării v0.5.7

### HACS

1. HACS → Integrations → Custom repositories.
2. Adaugă repository-ul:
   `https://github.com/caiuspoputa-debug/ha-aqara-m1s-zigbee-router`
3. Categoria: **Integration**.
4. Pentru această procedură reproductibilă selectează release-ul **0.5.7** și confirmă după instalare că `manifest.json` arată `0.5.7`; opțiunea „latest” se poate schimba ulterior.
5. HACS instalează direct repository-ul; nu este necesar un ZIP separat atașat release-ului.
6. Repornește complet Home Assistant.

### Manual

Copiază directorul:

```text
custom_components/aqara_m1s_zigbee_router
```

în:

```text
/config/custom_components/aqara_m1s_zigbee_router
```

Repornește Home Assistant.

### Adăugarea hubului

Setări → Dispozitive și servicii → Adaugă integrare → **Aqara M1S Zigbee Router**.

Completează:

- Host: IP-ul rezervat al hubului;
- Port: `23`;
- Username: de regulă `admin`;
- Password: parola Telnet folosită, goală în configurația documentată;
- Name: numele unic al hubului.

> Config flow-ul salvează datele de conectare la hub. Verifică Telnet manual înainte de prima adăugare. Parola Wi-Fi introdusă ulterior în Configure nu este salvată în config entry sau options.

---

## 20. Entitățile curente

Pentru fiecare hub:

- **Ring Light** — RGB și luminozitate;
- **Media Player** — redare individuală, volum/mute live, pas 0,1%;
- **Include in M1S Media Group** — includerea hubului în grup;
- **Physical Button** — event MQTT;
- **Sound Playback Volume** — volum pentru WAV-urile locale;
- **Refresh Sound List**;
- câte un buton pentru fiecare WAV detectat;
- **Illuminance** — lux, ADC raw și millivolts;
- **Hub Temperature** — `persist.sys.temperature`;
- **WiFi IP**;
- stări pentru HomeKit Process, MQTT Process, Telnet Process și JN5189 Router.

Global, o singură entitate:

- **M1S Media Group** — cronologie PCM comună pentru huburile selectate.

Entitățile Number de volum fin au fost eliminate în v0.5.6 și rămân eliminate în v0.5.7; sliderul nativ are pas de 0,1%.

### Disponibilitate și revenire online

Coordonatorul verifică hubul la fiecare 15 secunde. Când hubul este offline, lumina, playerul, volumul și senzorii live devin indisponibili. Butoanele WAV rămân intenționat vizibile. La prima revenire online, integrarea așteaptă 10 secunde pentru stabilizarea Wi-Fi/Telnet/UART și trimite o singură comandă RGB OFF; ultima culoare și luminozitate selectate rămân memorate pentru următoarea aprindere manuală.

---

## 21. Audio și media

### Player individual

- port hub: `12346`;
- FFmpeg în Home Assistant → PCM `S32_LE`, mono, 32000 Hz;
- bucăți PCM de 20 ms;
- gain și mute live, rampă anti-click 40 ms;
- 3 retry-uri rapide la 5 secunde, apoi retry lent la 60 secunde;
- starea stabilă se resetează după 30 secunde;
- redarea individuală are prioritate față de grup;
- suportă `PLAY_MEDIA` și `BROWSE_MEDIA`, inclusiv surse Home Assistant `media-source://` și URL-uri HTTP/HTTPS;
- FFmpeg solicită best-effort `nice -5`, iar `aplay` pe hub `nice -3`; sunt priorități Linux normale, nu realtime, iar redarea continuă dacă sistemul le refuză.

Integrarea separată **Radio Favorites** poate folosi acest media player ca țintă, dar nu este necesară pentru funcționarea de bază.

### Grup media

- port hub: `12347`;
- o singură cronologie FFmpeg;
- 1,5 secunde tăcere de sincronizare;
- coadă de aproximativ 1 secundă;
- reconciliere la 3 secunde;
- resync complet cu protecție de 30 secunde;
- un hub offline este scos fără oprirea celorlalte; revenirea lui produce resync.

### Sunete WAV locale

- sursă hub: port `12347`;
- destinație PCM hub: port `12348`;
- upload: port `12349`;
- director administrat: `/data/musics/music-ch`;
- format: WAV PCM mono, 32000 Hz, signed 32-bit little-endian;
- limită upload: 20 MiB.

Conversie:

```sh
ffmpeg -y -i input.mp3 -ac 1 -ar 32000 -c:a pcm_s32le output.wav
```

### Administrarea sunetelor din Home Assistant

Deschide:

**Setări → Dispozitive și servicii → Aqara M1S Zigbee Router → Configurează**

Meniul curent oferă:

- **Schimbă rețeaua Wi-Fi / Change Wi-Fi network**;
- **Încărcare WAV / ZIP / Upload WAV / ZIP**;
- **Ștergere multiplă WAV / Delete multiple WAV files**, numai când există fișiere administrate;
- **Conectare la alt coordonator Zigbee / Join a different Zigbee coordinator**;
- **Finalizare și închidere / Finish and close**.

Încărcare:

1. alege un fișier WAV sau un ZIP care conține mai multe WAV-uri;
2. pentru WAV rămâne limita de 20 MiB per fișier; un ZIP poate conține maximum 64 WAV-uri și maximum 100 MiB total;
3. transferul principal folosește portul `12349`, verifică dimensiunea și MD5 înainte de înlocuirea destinației;
4. dacă transferul TCP eșuează, există fallback BusyBox `base64`, tot cu verificare;
5. fișierul ajunge numai în `/data/musics/music-ch`;
6. lista butoanelor de sunet se actualizează imediat;
7. după toate operațiile apasă **Finalizare și închidere** pentru reloadul complet și controlat al config entry-ului.

Ștergere:

1. selectează unul sau mai multe fișiere oferite de meniu;
2. confirmă o singură dată; toate fișierele selectate sunt șterse în aceeași operație;
3. apasă **Finalizare și închidere**.

Sunetele originale din directoare precum `/data/musics/music-scene` nu sunt oferite pentru ștergere. Butonul **X** al ferestrei aparține frontendului Home Assistant: închiderea cu X nu anulează uploadul/ștergerea și lista se reîmprospătează imediat, dar sare reloadul final al config entry-ului.


### Schimbarea Wi-Fi direct din integrare (v0.5.7)

Această opțiune apare numai ca interfață de comandă; mecanismul sigur rulează pe hub și necesită instalarea prealabilă a `installers/m1s_wifi_recovery_SANITIZED.tgz` din etapa 14.

1. În router, rezervă **același IP** pentru MAC-ul Wi-Fi al hubului pe noua rețea, dacă este posibil. Integrarea este configurată după IP.
2. Deschide **Setări → Dispozitive și servicii → Aqara M1S Zigbee Router → Configurează → Schimbă rețeaua Wi-Fi**.
3. Introdu noul SSID și parola; parola este afișată mascat și **nu este salvată** în datele sau opțiunile Home Assistant.
4. Bifează confirmarea și pornește schimbarea.
5. Integrarea scrie temporar candidatul numai pe hub, cu permisiuni `0600`, apoi pornește `wifi_apply_candidate.sh`.
6. Helperul șterge mai întâi un IPv4 vechi rămas pe interfață, pornește asocierea la noul SSID și consideră testul reușit numai după apariția unui **IPv4 proaspăt**.
7. Numai după succes, SSID-ul și parola devin copia `safe/` folosită la recovery. Dacă testul eșuează, rulează mecanismul de recuperare/AP existent.

Este normal ca Home Assistant să marcheze temporar hubul offline în timpul schimbării. Dacă noua rețea acordă alt IP, integrarea nu îl poate ghici automat; actualizează rezervarea DHCP astfel încât hubul să păstreze IP-ul configurat sau reconfigurează integrarea ulterior.

> Nu folosi opțiunea dacă modulul Wi-Fi recovery nu este instalat și verificat. Integrarea va refuza pornirea dacă `/data/m1s_wifi/wifi_apply_candidate.sh` lipsește.

### Descărcarea unui WAV existent de pe hub

Interfața Configure încarcă și șterge, dar nu oferă download. Folosește un listener temporar LAN-only pe `1889`.

Pe hub:

```sh
find /data/musics -type f -name '*.wav'
nc -l -p 1889 < /data/musics/music-scene/disarm.wav
```

În Windows:

```powershell
.\scripts\windows\Receive-FileFromM1S.ps1 `
  -HubIp HUB_IP `
  -OutputPath "$env:USERPROFILE\Downloads\disarm.wav" `
  -Port 1889
```

Scriptul Windows afișează calea, dimensiunea și SHA256. Listenerul `nc` este one-shot și se închide după transfer. Nu publica portul `1889` în Internet.

### Limitare cunoscută importantă rămasă în v0.5.7

Grupul media și sursa sunetelor WAV folosesc ambele portul `12347`. Nu porni un WAV local pe un hub în timp ce receptorul de grup al acelui hub deține portul. Aceasta trebuie verificată și corectată în introspecția de cod ulterioară; README-ul nu pretinde că arbitrajul dintre cele două trasee este rezolvat.

---

## 22. Servicii Home Assistant

Domeniu: `aqara_m1s_zigbee_router`

```text
play_url
play_sound
run_command
upload_sound
delete_sound
refresh_sounds
```

`run_command` execută o comandă shell prin Telnet pe hub și trebuie tratat ca acces administrativ complet. Nu îl expune utilizatorilor neautorizați și nu construi automatizări din input nevalidat.

---

# PARTEA VI — Butonul fizic prin MQTT

## 23. Etapa 13 — Instalarea bridge-ului opțional

Integrarea Home Assistant expune entitatea `Physical Button`, dar are nevoie de un publisher pe hub. Arhivele vechi nu conțineau acest publisher; kitul actual îl furnizează separat.

### Ce face

- citește `/var/log/messages`;
- filtrează liniile `mha_master` cu `on_message basis.button`;
- nu deschide `/dev/input/event0`;
- aplică o fereastră de 1,2 secunde pentru a păstra gestul final;
- publică MQTT QoS 0:
  `m1s/<ultimul_octet_IP>/button/action`;
- valori: `click`, `double_click`, `triple_click`, `quadruple_click`, `five_click`, `hold`.

### Transfer și instalare

Pe hub:

```sh
rm -f /tmp/m1s_button_bridge_SANITIZED.tgz
nc -l -p 12345 > /tmp/m1s_button_bridge_SANITIZED.tgz
```

În Windows:

```powershell
.\scripts\windows\Send-FileToM1S.ps1 `
  -HubIp HUB_IP `
  -Path .\installers\m1s_button_bridge_SANITIZED.tgz
```

Pe hub:

```sh
rm -rf /tmp/m1s_button_install
mkdir -p /tmp/m1s_button_install
cd /tmp/m1s_button_install
tar -xzf /tmp/m1s_button_bridge_SANITIZED.tgz
/bin/sh -n install.sh
./install.sh
```

### Configurare fără parole în arhivă

```sh
cp /data/m1s_button/m1s_button.conf.example /data/m1s_button/m1s_button.conf
```

Editează numai pe hub și înlocuiește `HOME_ASSISTANT_IP`:

```sh
cat > /data/m1s_button/m1s_button.conf <<'EOF_BUTTON_CONF'
BROKER_HOST="HOME_ASSISTANT_IP"
BROKER_PORT="1883"
HUB_ID=""
MQTT_USERNAME_FILE="/data/m1s_button/mqtt_username"
MQTT_PASSWORD_FILE="/data/m1s_button/mqtt_password"
EOF_BUTTON_CONF
```

Scrie credentialele MQTT fără să le afișezi în README sau istoric. Înlocuiește local valorile din comenzile următoare:

```sh
printf '%s' 'MQTT_USERNAME_LOCAL' > /data/m1s_button/mqtt_username
printf '%s' 'MQTT_PASSWORD_LOCAL' > /data/m1s_button/mqtt_password
chmod 600 /data/m1s_button/m1s_button.conf \
  /data/m1s_button/mqtt_username \
  /data/m1s_button/mqtt_password
sync
```

Pentru broker fără autentificare, lasă cele două fișiere de credentiale goale.

### Test fără apăsarea butonului

```sh
/data/m1s_button/m1s_mqtt_publish.sh click
echo "rc=$?"
```

Așteaptă `rc=0`. Verifică în Home Assistant Developer Tools → Events sau cu un subscriber MQTT că payloadul ajunge pe topicul exact.

### Pornire watcher

```sh
/data/m1s_button/button_watch.sh >/tmp/m1s_button_console.log 2>&1 &
```

După reboot, `post_init.sh` îl pornește automat dacă există configurația.

```sh
ps w | grep '[b]utton_watch.sh'
tail -f /tmp/m1s_button.log
```

Nu publica fișierele `m1s_button.conf`, `mqtt_username` sau `mqtt_password`.

---

# PARTEA VII — Recuperare Wi-Fi

## 24. Etapa 14 — Installerul Wi-Fi sanitizat, opțional

Pachetul:

```text
installers/m1s_wifi_recovery_SANITIZED.tgz
```

nu conține SSID sau parolă. Fișierele `safe/ssid` și `safe/pass` din payload sunt goale, iar installerul preia valorile curente direct de pe hub înainte de înlocuire.

### Înainte de instalare

Rulează mai întâi etapa 9A. Modulul de recovery nu repară logica stock de provisioning care poate alege AP imediat după boot; el intervine numai ulterior, după lipsa IPv4 pentru pragul configurat. Dacă hubul intră în AP la aproximativ 20 de secunde de la boot, verifică proprietățile Aqara înainte de a suspecta managerul de recovery.

### Funcționare

- managerul verifică IPv4 la fiecare 10 secunde;
- după 240 secunde fără IPv4 poate porni AP;
- AP-ul este automat numai dacă există `/data/m1s_wifi/actions_enabled`;
- fără acel fișier, managerul rămâne în simulare și doar scrie în log ce ar face;
- portalul de configurare ascultă pe `8080`;
- noua rețea devine backup numai după obținerea unui IPv4;
- la eșec, hubul revine în AP și ulterior la rețeaua sigură.

### Transfer și instalare

Hub:

```sh
rm -f /tmp/m1s_wifi_recovery_SANITIZED.tgz
nc -l -p 12345 > /tmp/m1s_wifi_recovery_SANITIZED.tgz
```

Windows:

```powershell
.\scripts\windows\Send-FileToM1S.ps1 `
  -HubIp HUB_IP `
  -Path .\installers\m1s_wifi_recovery_SANITIZED.tgz
```

Hub:

```sh
rm -rf /tmp/m1s_wifi_install
mkdir -p /tmp/m1s_wifi_install
cd /tmp/m1s_wifi_install
tar -xzf /tmp/m1s_wifi_recovery_SANITIZED.tgz
/bin/sh -n install.sh
./install.sh
```

Rezultat așteptat:

```text
WIFI_RECOVERY_INSTALL_OK
```

### Verificare fără afișarea credentialelor

```sh
wc -c /data/m1s_wifi/safe/ssid /data/m1s_wifi/safe/pass
ls -l /data/m1s_wifi/safe/ssid /data/m1s_wifi/safe/pass
ps w | grep '[w]ifi_manager.sh'
ps w | grep '[m]1s_wifi_portal_safe.sh'
tail -n 80 /tmp/m1s_wifi_manager.log
```

Ambele fișiere trebuie să aibă dimensiune mai mare de zero și permisiuni restrictive. Nu folosi `cat` asupra parolei în capturi sau loguri.

### Test în modul simulare

```sh
touch /data/m1s_wifi/test_noip
sleep 20
tail -n 30 /tmp/m1s_wifi_manager.log
rm -f /data/m1s_wifi/test_noip
```

Pentru că `actions_enabled` lipsește, logul trebuie să arate că AP-ul **ar fi pornit**, fără schimbarea reală a rețelei.

### Activarea recuperării reale

Activează numai după testul de simulare și după ce ai confirmat că backupul Wi-Fi local este populat:

```sh
touch /data/m1s_wifi/actions_enabled
chmod 600 /data/m1s_wifi/actions_enabled
sync
```

Dezactivare:

```sh
rm -f /data/m1s_wifi/actions_enabled
```

În AP, portalul este accesat direct la una dintre adresele detectate de hub:

```text
http://192.168.49.1:8080/
http://192.168.1.1:8080/
```

Nu expune portul 8080 în afara LAN-ului.

---

# PARTEA VIII — Porturi, fișiere și procese

## 25. Inventar de porturi

| Port | Direcție/rol | Permanent |
|---:|---|---|
| 23 | Telnet către hub | da, numai LAN |
| 1886 | tunel UART JN5189 creat de integrare | la nevoie |
| 1888 | ISP temporar SPSDK | nu; închide după programare |
| 1889 | transfer temporar WAV/fișier de pe hub | nu |
| 8080 | portal recuperare Wi-Fi | opțional |
| 12345 | transfer manual temporar către hub | nu |
| 12346 | media player individual | în timpul redării |
| 12347 | grup media și, separat, sursa WAV locală | în timpul redării; conflict cunoscut |
| 12348 | destinație PCM pentru WAV local | în timpul redării |
| 12349 | upload WAV | temporar |
| 1884 | client/tunel MQTT legacy din cod | nefolosit de fluxul curent |

Porturile listener ale hubului nu trebuie publicate în Internet.

---

## 26. Fișiere persistente importante

```text
/data/scripts/post_init.sh
/data/m1s_wifi/
/data/m1s_wifi/safe/ssid
/data/m1s_wifi/safe/pass
/data/m1s_wifi/actions_enabled
/data/m1s_button/button_watch.sh
/data/m1s_button/m1s_mqtt_publish.sh
/data/m1s_button/m1s_button.conf
/data/m1s_button/mqtt_username
/data/m1s_button/mqtt_password
/data/musics/music-ch/
```

Fișiere sensibile care nu se publică:

- backupurile JN5189 stock;
- tokenul MiIO;
- SSID/parola Wi-Fi;
- configurația și credentialele MQTT;
- datele Telnet când nu sunt goale.

---

## 27. Procese așteptate

După boot și înainte de redare:

- `telnetd` — prezent;
- `app_monitor` — suspendat (`T`);
- `mzigbee_agent` — absent sau zombie;
- `mha_master` — prezent pentru serviciile stock și buton;
- `wifi_manager.sh` — prezent numai dacă modulul Wi-Fi este instalat;
- `m1s_wifi_portal_safe.sh` — prezent numai dacă modulul Wi-Fi este instalat;
- `button_watch.sh` — prezent numai dacă bridge-ul este instalat/configurat;
- fără `cat /dev/ttyS1` permanent în afara tunelului temporar administrat de integrare.

---

# PARTEA IX — Verificarea finală „hub refăcut din prima”

## 28. Checklist obligatoriu

### Hardware și backup

- [ ] modelul este `lumi.gateway.aeu01`;
- [ ] IP DHCP rezervat și stabil;
- [ ] token MiIO verificat și păstrat separat;
- [ ] două backupuri stock de 646656 bytes;
- [ ] SHA256 identic între cele două backupuri;
- [ ] backupurile salvate în două locații.

### Firmware

- [ ] firmware 209296 bytes;
- [ ] SHA256 `a1a1f302...e7a2f`;
- [ ] SPSDK detectează JN5189 și memoria corectă;
- [ ] erase limitat la `0x33200` numai când este necesar;
- [ ] write reușit;
- [ ] readback identic SHA256;
- [ ] portul 1888 închis;
- [ ] GPIO33=`1`, GPIO18=`0`;
- [ ] `BDB-Router` online în Zigbee2MQTT.

### Boot persistent

- [ ] `aqara_wifi_boot_state.sh check` arată `STA_EXPECTED`;
- [ ] `fw_manager.sh -r` este păstrat și nu apare nicăieri `fw_manager.sh -f -r`;
- [ ] `/tmp/post_init.log` creat după reboot;
- [ ] Telnet disponibil;
- [ ] `app_monitor` suspendat;
- [ ] `mzigbee_agent` nu ocupă UART-ul;
- [ ] inelul de boot se stinge;
- [ ] Routerul revine automat după power cycle.

### Home Assistant

- [ ] manifestul integrării arată `0.5.7`;
- [ ] toate entitățile live sunt disponibile;
- [ ] RGB și lux funcționează;
- [ ] media player individual pornește/oprește și își păstrează volumul;
- [ ] grupul funcționează cu minimum două huburi selectate;
- [ ] un hub offline nu oprește permanent celelalte;
- [ ] revenirea hubului produce resync;
- [ ] upload/listare/redare WAV testate fără grup activ pe același port.

### Opționale

- [ ] buton MQTT testat întâi cu publisher manual;
- [ ] toate cele șase gesturi verificate fizic;
- [ ] installerul Wi-Fi are safe/ssid și safe/pass populate local;
- [ ] testul `test_noip` în simulare a trecut;
- [ ] `actions_enabled` creat numai după simulare;
- [ ] niciun secret nu există în arhiva distribuită.

---

# PARTEA X — Recuperare

## 29. `TimeoutError` în SPSDK

Cauzele cele mai frecvente documentate:

- integrarea Home Assistant recreează `cat /dev/ttyS1`;
- un shell Telnet vechi ține UART-ul;
- listenerul BusyBox `nc` s-a închis după o comandă;
- JN5189 nu a fost resetat în ISP;
- GPIO33 nu este `0`;
- portul 1888 este ocupat sau filtrat.

Procedură:

1. dezactivează integrarea Home Assistant;
2. restart fizic al hubului numai dacă nu ești între erase și write;
3. suspendă `app_monitor`;
4. oprește `mzigbee_agent` și orice `cat /dev/ttyS1`;
5. rulează din nou `jn5189_enter_isp_1888.sh`;
6. confirmă `info`;
7. continuă de la ultimul pas sigur, nu repeta automat erase.

---

## 30. Restaurarea firmware-ului stock JN5189

Folosește numai backupul exact al aceluiași hub.

1. intră în ISP;
2. rulează `info`;
3. șterge numai zona necesară, conform dimensiunii imaginii de restaurat;
4. scrie backupul original în Memory ID 0 la `0x0`;
5. citește-l înapoi pe aceeași lungime;
6. compară SHA256 cu backupul original;
7. închide listenerul;
8. pornește JN5189 normal;
9. pentru revenire complet stock trebuie restaurat și comportamentul boot care permite `mzigbee_agent`; simpla scriere a flashului JN5189 nu anulează automat `post_init.sh`.

Nu scrie backupul unui alt hub.

---

## 31. Revenirea la boot stock Linux

Pentru diagnostic, nu șterge imediat scriptul. Redenumește-l și păstrează backupul:

```sh
mv /data/scripts/post_init.sh /data/scripts/post_init.sh.disabled
sync
reboot
```

Aceasta permite serviciilor stock să pornească normal, inclusiv agentul Zigbee original. Un JN5189 care încă are firmware Router nu devine stock doar prin dezactivarea scriptului; evită să lași `mzigbee_agent` să concureze inutil cu firmware-ul Router.

---

## 32. Probleme audio

Verifică numai procesele și PID-urile traseului implicat:

```sh
ps w | grep -E '[n]c -l -p 12346|[n]c -l -p 12347|[n]c -l -p 12348|[a]play'
netstat -lnt | grep -E ':(12346|12347|12348|12349)( |$)'
```

Nu folosi `killall nc` sau `killall aplay`. Integrarea folosește PID files și filtre pe linia de comandă tocmai pentru a nu întrerupe alte funcții.

---

## 33. Probleme cu butonul

```sh
ps w | grep '[m]ha_master'
ps w | grep '[b]utton_watch.sh'
tail -f /var/log/messages | grep 'on_message basis.button'
tail -n 100 /tmp/m1s_button.log
```

Dacă evenimentul există în log, dar nu ajunge în Home Assistant, testează publisherul manual și topicul MQTT. Dacă evenimentul nu apare în log, problema este înaintea bridge-ului.

---

## 34. Probleme cu recuperarea Wi-Fi

Separă mai întâi cele două cazuri:

1. **AP imediat după boot** — verifică `cloud_provisioned`, `hap_provisioned` și `hap_keepalive` cu `aqara_wifi_boot_state.sh check`;
2. **AP după aproximativ 240 secunde fără IPv4** — investighează managerul opțional de recovery.

```sh
ps w | grep '[w]ifi_manager.sh'
ps w | grep '[m]1s_wifi_portal_safe.sh'
tail -n 120 /tmp/m1s_wifi_manager.log
ls -l /data/m1s_wifi/actions_enabled
wc -c /data/m1s_wifi/safe/ssid /data/m1s_wifi/safe/pass
```

Nu afișa conținutul `safe/pass`. Pentru revenire manuală la STA:

```sh
rm -f /data/m1s_wifi/ap_hold
/data/m1s_wifi/restore_sta.sh
```

---

# PARTEA XI — Actualizare și disciplină de versiune

## 35. Actualizarea integrării Home Assistant

1. fă backup Home Assistant;
2. notează versiunea manifestului;
3. actualizează prin HACS sau copiere manuală;
4. repornește complet Home Assistant;
5. verifică logurile și entitățile eliminate/migrate;
6. testează un singur hub înaintea tuturor.

Integrarea v0.5.6 elimină automat din registru vechile entități Number pentru volum fin.

---

## 36. Actualizarea firmware-ului JN5189

Pentru un Router funcțional:

- păstrează backupul stock;
- salvează și imaginea Router curentă;
- verifică hashul nou;
- dezactivează integrarea HA;
- intră în ISP;
- folosește scriere directă fără erase, exceptând cazul în care noul build cere explicit altceva;
- efectuează readback și comparație;
- testează Zigbee, RGB, lux și rejoin.

Numele fișierului nu este dovadă de identitate; hashul este obligatoriu.

---

## 37. Ce nu este rezolvat doar prin documentație

Pentru introspecția ulterioară de cod rămân cel puțin următoarele puncte:

1. conflictul portului `12347` între grup și sursa WAV;
2. fișierul `mqtt_client.py` legacy, prezent dar nefolosit;
3. `select.py` legacy, prezent dar platforma nu este încărcată;
4. lipsa unei verificări reale de conectivitate în config flow;
5. securizarea suplimentară a serviciului `run_command`;
6. testarea fizică a bridge-ului butonului standardizat;
7. testarea fizică a installerului Wi-Fi sanitizat și a tuturor ramurilor AP/rollback;
8. verificarea comportamentului la log rotation pentru watcherul butonului;
9. eliminarea sau arhivarea codului/fișierelor istorice care nu mai aparțin release-ului curent;
10. clarificarea descriptorului ZCL care menține switch-ul expus în Zigbee2MQTT; buildul experimental `no_switch` nu a demonstrat rezolvarea și nu este inclus ca firmware recomandat.

Acestea sunt documentate intenționat, nu ascunse sub afirmația „totul este final”.

---

## 38. Regula de aur pentru refacerea următorului hub

Pentru fiecare hub nou, urmează aceeași ordine fără scurtături:

```text
model/IP → token/Telnet → verificare STA/AP → post_init verificat → ISP info →
două backupuri stock identice → firmware hash → erase limitat numai la stock →
write → readback identic → închidere ISP → Permit join → boot Router →
reboot și verify_hub → Home Assistant → opționale buton/Wi-Fi → checklist final
```

Nu trece la etapa următoare până când criteriul de acceptare al etapei curente este îndeplinit.
