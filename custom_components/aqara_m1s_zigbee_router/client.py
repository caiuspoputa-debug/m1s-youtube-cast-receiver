import socket
import threading
import time
import base64
import io
import wave
import hashlib
from pathlib import PurePosixPath
from dataclasses import dataclass, field

from .const import MANAGED_SOUND_ROOT

UART_PORT = 1886
UART_FIFO = "/tmp/ha_m1s_uart_fifo"
UART_CAT_PID = "/tmp/ha_m1s_uart_cat.pid"
UART_NC_PID = "/tmp/ha_m1s_uart_nc.pid"
UART_REQUEST_LUX = bytes([0xA6, 0x00, 0x00, 0x00, 0xA6])
UART_REQUEST_REJOIN = bytes([0xA7, 0x52, 0x4A, 0x4E, 0xF1])
UART_RESPONSE_REJOIN = bytes([0xA7, 0x4F, 0x4B, 0x00, 0xA3])

UPLOAD_PORT = 12349
UPLOAD_TEMP = "/tmp/ha_m1s_sound_upload.wav"
UPLOAD_PID = "/tmp/ha_m1s_sound_upload_nc.pid"

UART_STOP_COMMAND = (
    f"for f in {UART_CAT_PID} {UART_NC_PID}; do "
    '[ -f "$f" ] && kill -9 "$(cat "$f")" 2>/dev/null; '
    "done; "
    f"rm -f {UART_CAT_PID} {UART_NC_PID} {UART_FIFO}"
)

UART_START_COMMAND = (
    "if ! netstat -lnt 2>/dev/null | grep -q ':1886 '; then "
    + UART_STOP_COMMAND
    + f"; mkfifo {UART_FIFO}; "
    + "stty -F /dev/ttyS1 115200 raw -echo; "
    + f"cat /dev/ttyS1 > {UART_FIFO} 2>/tmp/ha_m1s_uart_cat.log & "
    + f"echo $! > {UART_CAT_PID}; "
    + f"nc -l -p {UART_PORT} < {UART_FIFO} > /dev/ttyS1 "
      "2>/tmp/ha_m1s_uart_nc.log & "
    + f"echo $! > {UART_NC_PID}; "
    + "fi"
)

IAC = 255
DONT = 254
DO = 253
WONT = 252
WILL = 251


@dataclass
class AqaraM1SClient:
    host: str
    port: int = 23
    username: str = "admin"
    password: str = ""
    timeout: float = 8.0
    _sock: socket.socket | None = field(default=None, init=False, repr=False)
    _uart_sock: socket.socket | None = field(default=None, init=False, repr=False)
    _uart_rx: bytearray = field(default_factory=bytearray, init=False, repr=False)
    _lock: threading.RLock = field(default_factory=threading.RLock, init=False, repr=False)
    _command_id: int = field(default=0, init=False, repr=False)

    def _negotiate(self, data: bytes) -> bytes:
        out = bytearray()
        i = 0
        while i < len(data):
            if data[i] == IAC and i + 2 < len(data):
                i += 3
                continue
            out.append(data[i])
            i += 1
        return bytes(out)

    def _reply_negotiation(self, sock: socket.socket, data: bytes) -> None:
        i = 0
        replies = bytearray()
        while i < len(data):
            if data[i] == IAC and i + 2 < len(data):
                cmd = data[i + 1]
                opt = data[i + 2]
                if cmd == WILL:
                    replies += bytes([IAC, DONT, opt])
                elif cmd == DO:
                    replies += bytes([IAC, WONT, opt])
                i += 3
            else:
                i += 1
        if replies:
            sock.sendall(replies)

    def _read_some(self, sock: socket.socket, seconds: float = 0.5) -> str:
        end = time.monotonic() + seconds
        chunks = []
        while time.monotonic() < end:
            try:
                data = sock.recv(4096)
                if not data:
                    raise ConnectionError("Telnet connection closed by hub")
                self._reply_negotiation(sock, data)
                chunks.append(self._negotiate(data))
            except socket.timeout:
                break
        return b"".join(chunks).decode("latin1", errors="ignore")

    def _read_until_any(self, sock: socket.socket, markers, timeout: float = 8.0) -> str:
        end = time.monotonic() + timeout
        text = ""
        while time.monotonic() < end:
            text += self._read_some(sock, min(0.4, max(0.05, end - time.monotonic())))
            low = text.lower()
            for marker in markers:
                if marker.lower() in low:
                    return text
        return text

    def _close_locked(self) -> None:
        sock = self._sock
        self._sock = None
        if sock is None:
            return
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            sock.close()
        except OSError:
            pass

    def close(self) -> None:
        with self._lock:
            self._close_uart_locked()
            try:
                self._run_command_locked(UART_STOP_COMMAND)
            except Exception:
                pass
            self._close_locked()

    def _close_uart_locked(self) -> None:
        sock = self._uart_sock
        self._uart_sock = None
        self._uart_rx.clear()
        if sock is None:
            return
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            sock.close()
        except OSError:
            pass

    def _connect_uart_locked(self) -> socket.socket:
        if self._uart_sock is not None:
            return self._uart_sock

        self.run_command(UART_START_COMMAND)
        last_error: OSError | None = None
        for _ in range(20):
            try:
                sock = socket.create_connection(
                    (self.host, UART_PORT), timeout=1.0
                )
                sock.settimeout(0.25)
                self._uart_sock = sock
                return sock
            except OSError as err:
                last_error = err
                time.sleep(0.1)
        assert last_error is not None
        raise ConnectionError(
            f"Could not connect to the JN5189 UART tunnel on port {UART_PORT}"
        ) from last_error

    def _uart_send_locked(self, frame: bytes) -> None:
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                self._connect_uart_locked().sendall(frame)
                return
            except (OSError, ConnectionError) as err:
                last_error = err
                self._close_uart_locked()
                if attempt == 0:
                    continue
        assert last_error is not None
        raise last_error

    def _connect_locked(self) -> socket.socket:
        if self._sock is not None:
            return self._sock

        sock = socket.create_connection((self.host, int(self.port)), timeout=self.timeout)
        sock.settimeout(0.35)

        try:
            initial = self._read_until_any(sock, ["login:", "#", "$"], timeout=4)
            if "login:" in initial.lower():
                sock.sendall((self.username + "\n").encode())
                after_user = self._read_until_any(sock, ["password:", "#", "$"], timeout=4)
                if "password:" in after_user.lower():
                    sock.sendall((self.password + "\n").encode())
                    prompt = self._read_until_any(sock, ["#", "$"], timeout=5)
                    if "#" not in prompt and "$" not in prompt:
                        raise ConnectionError("Telnet login did not reach a shell prompt")
            self._sock = sock
            return sock
        except Exception:
            try:
                sock.close()
            except OSError:
                pass
            raise

    def _run_command_locked(self, command: str) -> str:
        sock = self._connect_locked()

        # Discard any delayed prompt/output left from the previous command.
        try:
            self._read_some(sock, 0.05)
        except ConnectionError:
            self._close_locked()
            raise

        self._command_id += 1
        marker = f"__M1S_{self._command_id}_{time.monotonic_ns()}__"
        begin = f"{marker}:BEGIN"
        end = f"{marker}:END:"
        wrapped = (
            f"__m1s_tag='{marker}'\n"
            "printf '%s:BEGIN\\n' \"$__m1s_tag\"\n"
            f"{command}\n"
            "__m1s_rc=$?\n"
            "printf '%s:END:%s\\n' \"$__m1s_tag\" \"$__m1s_rc\"\n"
        )
        sock.sendall(wrapped.encode())
        response = self._read_until_any(sock, [end], timeout=self.timeout)
        if begin not in response or end not in response:
            raise TimeoutError(f"Command did not finish within {self.timeout} seconds")

        # The marker is assembled through a shell variable, so even on hubs
        # that echo Telnet input the literal BEGIN/END frames occur only in the
        # executed output. Return only the command payload between them.
        payload = response.rsplit(begin, 1)[1].split(end, 1)[0]
        return payload.strip("\r\n")

    def run_command(self, command: str) -> str:
        with self._lock:
            last_error: Exception | None = None
            for attempt in range(2):
                try:
                    return self._run_command_locked(command)
                except (OSError, ConnectionError, TimeoutError) as err:
                    last_error = err
                    self._close_locked()
                    if attempt == 0:
                        continue
            assert last_error is not None
            raise last_error


    def wifi_recovery_available(self) -> bool:
        """Return True when the safe Wi-Fi recovery module is installed."""
        out = self.run_command(
            "if [ -x /data/m1s_wifi/wifi_apply_candidate.sh ]; "
            "then echo __M1S_WIFI_READY__; else echo __M1S_WIFI_MISSING__; fi"
        )
        return "__M1S_WIFI_READY__" in out

    def start_wifi_change(self, ssid: str, password: str) -> None:
        """Stage a new Wi-Fi candidate and start the hub-side safe test.

        The password is not written to Home Assistant storage or logs.  It is
        transferred over the already-configured Telnet session, staged in
        mode-0600 files on the hub and then consumed by the Wi-Fi recovery
        helper.  The helper promotes the candidate only after a fresh IPv4
        address is obtained.
        """
        if not ssid or not password:
            raise ValueError("SSID and Wi-Fi password are required")
        if len(ssid.encode("utf-8")) > 32:
            raise ValueError("SSID is longer than 32 UTF-8 bytes")
        if "\x00" in ssid or "\x00" in password:
            raise ValueError("NUL is not allowed in Wi-Fi credentials")

        ssid_b64 = base64.b64encode(ssid.encode("utf-8")).decode("ascii")
        pass_b64 = base64.b64encode(password.encode("utf-8")).decode("ascii")
        command = (
            "BASE=/data/m1s_wifi; CAND=$BASE/candidate; "
            "LOCK=$BASE/ha_wifi_change.lock; "
            "if [ ! -x $BASE/wifi_apply_candidate.sh ]; then "
            "echo __M1S_WIFI_MISSING__; "
            "elif ! mkdir $LOCK 2>/dev/null; then "
            "echo __M1S_WIFI_BUSY__; "
            "else "
            "mkdir -p $CAND; "
            f"printf '%s' '{ssid_b64}' | base64 -d > $CAND/ssid.new && "
            f"printf '%s' '{pass_b64}' | base64 -d > $CAND/pass.new && "
            "chmod 600 $CAND/ssid.new $CAND/pass.new && "
            "mv $CAND/ssid.new $CAND/ssid && mv $CAND/pass.new $CAND/pass && "
            "nohup sh -c 'sleep 3; "
            "/data/m1s_wifi/wifi_apply_candidate.sh; rc=$?; "
            "rmdir /data/m1s_wifi/ha_wifi_change.lock 2>/dev/null; exit $rc' "
            ">/tmp/m1s_wifi_ha_change.log 2>&1 </dev/null & "
            "echo __M1S_WIFI_STARTED__; "
            "fi"
        )
        out = self.run_command(command)
        if "__M1S_WIFI_MISSING__" in out:
            raise RuntimeError("Wi-Fi recovery module is not installed")
        if "__M1S_WIFI_BUSY__" in out:
            raise RuntimeError("Another Wi-Fi change is already running")
        if "__M1S_WIFI_STARTED__" not in out:
            raise RuntimeError("Hub did not start the Wi-Fi change")

    def list_sounds(self) -> list[str]:
        out = self.run_command('find /data/musics -type f -name "*.wav" 2>/dev/null')
        sounds = []
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("/data/musics/") and line.endswith(".wav"):
                sounds.append(line)
        return sorted(set(sounds))

    def check_online(self) -> bool:
        """Verify that the Linux side and the JN5189 UART are reachable."""
        try:
            out = self.run_command(
                "if test -c /dev/ttyS1 && "
                "test \"$(cat /sys/class/gpio/gpio33/value 2>/dev/null)\" = 1; "
                "then echo __M1S_ONLINE__; else echo __M1S_OFFLINE__; fi"
            )
            return "__M1S_ONLINE__" in out
        except Exception:
            return False

    @staticmethod
    def _safe_sound_path(path: str) -> str:
        candidate = PurePosixPath(path)
        if candidate.suffix.lower() != ".wav":
            raise ValueError("Only .wav files are supported")
        if candidate.parent != PurePosixPath(MANAGED_SOUND_ROOT):
            raise ValueError(
                f"Sound file must be directly inside {MANAGED_SOUND_ROOT}"
            )
        if ".." in candidate.parts:
            raise ValueError("Invalid sound path")
        return str(candidate)

    def set_rgb(self, red: int, green: int, blue: int) -> None:
        values = [max(0, min(255, int(value))) for value in (red, green, blue)]
        checksum = 0xA5 ^ values[0] ^ values[1] ^ values[2]
        frame = bytes([0xA5, *values, checksum])
        with self._lock:
            try:
                self._uart_send_locked(frame)
            except Exception:
                # Keep RGB usable even if the optional TCP UART proxy cannot start.
                escaped = "".join(f"\\{value:03o}" for value in frame)
                self.run_command(f"printf '{escaped}' > /dev/ttyS1")

    def read_illuminance(self) -> dict[str, int]:
        """Read a validated A6 lux response from the JN5189 firmware."""
        with self._lock:
            last_error: Exception | None = None
            for attempt in range(2):
                try:
                    sock = self._connect_uart_locked()

                    # Discard a stale partial frame left by a previous failed read.
                    self._uart_rx.clear()
                    sock.settimeout(0.02)
                    while True:
                        try:
                            stale = sock.recv(256)
                            if not stale:
                                raise ConnectionError("UART tunnel closed")
                        except socket.timeout:
                            break

                    sock.sendall(UART_REQUEST_LUX)
                    deadline = time.monotonic() + 2.5
                    sock.settimeout(0.25)
                    while time.monotonic() < deadline:
                        try:
                            chunk = sock.recv(256)
                            if not chunk:
                                raise ConnectionError("UART tunnel closed")
                            self._uart_rx.extend(chunk)
                        except socket.timeout:
                            pass

                        while self._uart_rx:
                            try:
                                start = self._uart_rx.index(0xA6)
                            except ValueError:
                                self._uart_rx.clear()
                                break
                            if start:
                                del self._uart_rx[:start]
                            if len(self._uart_rx) < 8:
                                break
                            response = bytes(self._uart_rx[:8])
                            if response[7] == self._xor_checksum(response[:7]):
                                del self._uart_rx[:8]
                                return {
                                    "raw": int.from_bytes(response[1:3], "big"),
                                    "millivolts": int.from_bytes(response[3:5], "big"),
                                    "lux": int.from_bytes(response[5:7], "big"),
                                }
                            del self._uart_rx[0]
                    raise TimeoutError("No valid A6 lux response from JN5189")
                except (OSError, ConnectionError, TimeoutError) as err:
                    last_error = err
                    self._close_uart_locked()
                    if attempt == 0:
                        continue
            assert last_error is not None
            raise last_error

    def rejoin_zigbee_network(self) -> None:
        """Clear JN5189 Zigbee context and start steering after its reset."""
        with self._lock:
            last_error: Exception | None = None
            for attempt in range(2):
                try:
                    sock = self._connect_uart_locked()

                    # Do not let an old lux response be mistaken for the ACK.
                    self._uart_rx.clear()
                    sock.settimeout(0.02)
                    while True:
                        try:
                            stale = sock.recv(256)
                            if not stale:
                                raise ConnectionError("UART tunnel closed")
                        except socket.timeout:
                            break

                    sock.sendall(UART_REQUEST_REJOIN)
                    deadline = time.monotonic() + 2.5
                    sock.settimeout(0.25)
                    while time.monotonic() < deadline:
                        try:
                            chunk = sock.recv(256)
                            if not chunk:
                                raise ConnectionError("UART tunnel closed")
                            self._uart_rx.extend(chunk)
                        except socket.timeout:
                            pass

                        if UART_RESPONSE_REJOIN in self._uart_rx:
                            self._close_uart_locked()
                            return

                    raise TimeoutError("No rejoin acknowledgement from JN5189")
                except (OSError, ConnectionError, TimeoutError) as err:
                    last_error = err
                    self._close_uart_locked()
                    if attempt == 0:
                        continue
            assert last_error is not None
            raise last_error

    @staticmethod
    def _xor_checksum(data: bytes) -> int:
        checksum = 0
        for value in data:
            checksum ^= value
        return checksum

    def upload_sound(self, destination: str, content: bytes) -> None:
        destination = self._safe_sound_path(destination)
        try:
            with wave.open(io.BytesIO(content), "rb") as wav:
                valid = (
                    wav.getnchannels() == 1
                    and wav.getframerate() == 32000
                    and wav.getsampwidth() == 4
                    and wav.getcomptype() == "NONE"
                )
        except (EOFError, wave.Error) as err:
            raise ValueError("The selected file is not a valid WAV file") from err
        if not valid:
            raise ValueError(
                "WAV must be uncompressed PCM, mono, 32000 Hz, 32-bit little-endian"
            )
        with self._lock:
            try:
                self._upload_sound_tcp_locked(destination, content)
            except Exception:
                # BusyBox base64 is slower but provides a proven fallback.
                self._upload_sound_base64_locked(destination, content)

    def _upload_sound_tcp_locked(self, destination: str, content: bytes) -> None:
        """Upload a WAV through a one-shot BusyBox nc listener and verify it."""
        parent = str(PurePosixPath(destination).parent)
        expected_size = len(content)
        expected_md5 = hashlib.md5(content).hexdigest()

        # Kill only stale upload listeners created for this dedicated port.
        # Do not use killall nc because the hub can have unrelated nc services.
        start_command = (
            f"for p in $(ps w | grep '[n]c -l -p {UPLOAD_PORT}' | "
            "awk '{print $1}'); do kill -9 \"$p\" 2>/dev/null; done; "
            f'[ -f {UPLOAD_PID} ] && kill -9 "$(cat {UPLOAD_PID})" 2>/dev/null; '
            f"rm -f {UPLOAD_PID} {UPLOAD_TEMP}; mkdir -p '{parent}'; "
            f"nc -l -p {UPLOAD_PORT} > {UPLOAD_TEMP} "
            "2>/tmp/ha_m1s_sound_upload.log & "
            f"echo $! > {UPLOAD_PID}; "
            "i=0; while [ $i -lt 50 ]; do "
            f"netstat -lnt 2>/dev/null | grep -q ':{UPLOAD_PORT}' && "
            "echo __M1S_UPLOAD_LISTEN__ && break; "
            "sleep 0.1; i=$((i+1)); done"
        )
        output = self.run_command(start_command)
        if "__M1S_UPLOAD_LISTEN__" not in output:
            raise ConnectionError("WAV upload listener did not start")

        upload_sock: socket.socket | None = None
        last_error: OSError | None = None
        for _ in range(30):
            try:
                upload_sock = socket.create_connection(
                    (self.host, UPLOAD_PORT), timeout=2.0
                )
                upload_sock.settimeout(10.0)
                break
            except OSError as err:
                last_error = err
                time.sleep(0.1)
        if upload_sock is None:
            assert last_error is not None
            raise ConnectionError("Could not connect to WAV upload port") from last_error

        try:
            upload_sock.sendall(content)
            upload_sock.shutdown(socket.SHUT_WR)
        finally:
            upload_sock.close()

        # nc is one-shot. Wait for it to close the file, then verify both size
        # and MD5 before replacing any existing destination file.
        finalize = (
            "i=0; while [ $i -lt 30 ]; do "
            f"pid=$(cat {UPLOAD_PID} 2>/dev/null); "
            "[ -z \"$pid\" ] || ! kill -0 \"$pid\" 2>/dev/null || "
            f"[ $(wc -c < {UPLOAD_TEMP} 2>/dev/null) -ge {expected_size} ] && break; "
            "sleep 0.2; i=$((i+1)); done; "
            f"actual=$(wc -c < {UPLOAD_TEMP} 2>/dev/null); "
            f"actual_md5=$(md5sum {UPLOAD_TEMP} 2>/dev/null | awk '{{print $1}}'); "
            f"if [ \"$actual\" = \"{expected_size}\" ] && "
            f"[ \"$actual_md5\" = \"{expected_md5}\" ]; then "
            f"mv {UPLOAD_TEMP} '{destination}'; chmod 664 '{destination}' 2>/dev/null; "
            f"rm -f {UPLOAD_PID}; echo __M1S_UPLOAD_OK__; "
            "else echo __M1S_UPLOAD_VERIFY_ERROR__:$actual:$actual_md5; fi"
        )
        output = self.run_command(finalize)
        if "__M1S_UPLOAD_OK__" not in output:
            self.run_command(
                f"[ -f {UPLOAD_PID} ] && kill -9 \"$(cat {UPLOAD_PID})\" "
                f"2>/dev/null; rm -f {UPLOAD_PID} {UPLOAD_TEMP}"
            )
            raise IOError(f"WAV upload verification failed: {output}")

    def _upload_sound_base64_locked(self, destination: str, content: bytes) -> None:
        """Fallback upload over Telnet using small base64 chunks, with MD5 check."""
        parent = str(PurePosixPath(destination).parent)
        encoded = base64.b64encode(content).decode("ascii")
        expected_size = len(content)
        expected_md5 = hashlib.md5(content).hexdigest()
        temp = "/tmp/ha_sound_upload.b64"
        decoded = "/tmp/ha_sound_upload_decoded.wav"
        self.run_command(f"mkdir -p '{parent}'; rm -f {temp} {decoded}; : > {temp}")
        for start in range(0, len(encoded), 1024):
            chunk = encoded[start : start + 1024]
            self.run_command(f"printf '%s' '{chunk}' >> {temp}")
        output = self.run_command(
            f"base64 -d {temp} > {decoded} && "
            f"actual=$(wc -c < {decoded}); "
            f"actual_md5=$(md5sum {decoded} | awk '{{print $1}}'); "
            f"if [ \"$actual\" = \"{expected_size}\" ] && "
            f"[ \"$actual_md5\" = \"{expected_md5}\" ]; then "
            f"mv {decoded} '{destination}'; chmod 664 '{destination}' 2>/dev/null; "
            "echo __M1S_UPLOAD_OK__; "
            "else echo __M1S_UPLOAD_VERIFY_ERROR__:$actual:$actual_md5; fi; "
            f"rm -f {temp} {decoded}"
        )
        if "__M1S_UPLOAD_OK__" not in output:
            raise IOError(f"Base64 WAV upload verification failed: {output}")

    def delete_sound(self, path: str) -> None:
        path = self._safe_sound_path(path)
        self.run_command(f"rm -f '{path}'")
