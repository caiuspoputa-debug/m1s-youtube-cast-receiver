from __future__ import annotations

import asyncio
from collections.abc import Callable
import inspect
import json
import logging
import random
from typing import Any

_LOGGER = logging.getLogger(__name__)

MessageCallback = Callable[[str, bytes], Any]
StatusCallback = Callable[[bool], Any]


def _encode_remaining_length(value: int) -> bytes:
    encoded = bytearray()
    while True:
        digit = value % 128
        value //= 128
        if value:
            digit |= 0x80
        encoded.append(digit)
        if not value:
            return bytes(encoded)


def _encode_utf8(value: str) -> bytes:
    raw = value.encode("utf-8")
    return len(raw).to_bytes(2, "big") + raw


class AqaraM1SMqttClient:
    """Small MQTT 3.1.1 client for the hub's local port-1884 tunnel.

    The BusyBox tunnel accepts one LAN client at a time, therefore one
    connection is shared by every entity belonging to this config entry.
    """

    def __init__(self, host: str, port: int = 1884) -> None:
        self.host = host
        self.port = int(port)

        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._runner: asyncio.Task | None = None
        self._ping_task: asyncio.Task | None = None
        self._write_lock = asyncio.Lock()
        self._stop_event = asyncio.Event()

        self._message_callbacks: list[MessageCallback] = []
        self._status_callbacks: list[StatusCallback] = []
        self._packet_id = random.randint(1, 65535)
        self.connected = False

    def add_message_listener(
        self,
        callback: MessageCallback,
    ) -> Callable[[], None]:
        self._message_callbacks.append(callback)

        def remove() -> None:
            if callback in self._message_callbacks:
                self._message_callbacks.remove(callback)

        return remove

    def add_status_listener(
        self,
        callback: StatusCallback,
    ) -> Callable[[], None]:
        self._status_callbacks.append(callback)

        def remove() -> None:
            if callback in self._status_callbacks:
                self._status_callbacks.remove(callback)

        return remove

    async def start(self) -> None:
        if self._runner and not self._runner.done():
            return
        self._stop_event.clear()
        self._runner = asyncio.create_task(
            self._connection_loop(),
            name=f"aqara_m1s_mqtt_{self.host}",
        )

    async def stop(self) -> None:
        self._stop_event.set()

        if self._ping_task:
            self._ping_task.cancel()
            self._ping_task = None

        await self._close_connection()

        if self._runner:
            self._runner.cancel()
            try:
                await self._runner
            except asyncio.CancelledError:
                pass
            self._runner = None

    async def publish_json(
        self,
        topic: str,
        payload: dict[str, Any],
    ) -> None:
        data = json.dumps(
            payload,
            separators=(",", ":"),
        ).encode("utf-8")
        await self.publish(topic, data)

    async def publish(self, topic: str, payload: bytes) -> None:
        if not self.connected or self._writer is None:
            raise ConnectionError(
                f"MQTT tunnel {self.host}:{self.port} is not connected"
            )

        variable_header = _encode_utf8(topic)
        packet = (
            bytes([0x30])
            + _encode_remaining_length(
                len(variable_header) + len(payload)
            )
            + variable_header
            + payload
        )
        await self._write(packet)

    async def _connection_loop(self) -> None:
        delay = 1
        while not self._stop_event.is_set():
            try:
                await self._connect()
                delay = 1
                await self._read_loop()
            except asyncio.CancelledError:
                raise
            except Exception as err:
                _LOGGER.warning(
                    "MQTT tunnel %s:%s disconnected: %s",
                    self.host,
                    self.port,
                    err,
                )
            finally:
                await self._close_connection()

            if self._stop_event.is_set():
                break

            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)

    async def _connect(self) -> None:
        self._reader, self._writer = await asyncio.wait_for(
            asyncio.open_connection(self.host, self.port),
            timeout=8,
        )

        client_id = f"ha_m1s_{random.randint(0, 0xFFFFFF):06x}"
        variable_header = (
            _encode_utf8("MQTT")
            + bytes([4])       # MQTT 3.1.1
            + bytes([0x02])    # clean session
            + (30).to_bytes(2, "big")
        )
        payload = _encode_utf8(client_id)
        packet = (
            bytes([0x10])
            + _encode_remaining_length(
                len(variable_header) + len(payload)
            )
            + variable_header
            + payload
        )
        await self._write(packet)

        header, body = await asyncio.wait_for(
            self._read_packet(),
            timeout=8,
        )
        if (
            header >> 4 != 2
            or len(body) != 2
            or body[1] != 0
        ):
            raise ConnectionError(
                f"Invalid MQTT CONNACK: header={header}, body={body!r}"
            )

        await self._subscribe(
            ["zigbee/send", "ioctl/recv"]
        )
        self._set_connected(True)

        self._ping_task = asyncio.create_task(
            self._ping_loop(),
            name=f"aqara_m1s_mqtt_ping_{self.host}",
        )
        _LOGGER.info(
            "Connected to Aqara MQTT tunnel %s:%s",
            self.host,
            self.port,
        )

    async def _subscribe(self, topics: list[str]) -> None:
        self._packet_id = (
            1 if self._packet_id >= 65535
            else self._packet_id + 1
        )
        variable_header = self._packet_id.to_bytes(2, "big")
        payload = b"".join(
            _encode_utf8(topic) + bytes([0])
            for topic in topics
        )
        packet = (
            bytes([0x82])
            + _encode_remaining_length(
                len(variable_header) + len(payload)
            )
            + variable_header
            + payload
        )
        await self._write(packet)

    async def _ping_loop(self) -> None:
        while (
            self.connected
            and not self._stop_event.is_set()
        ):
            await asyncio.sleep(20)
            if self.connected:
                await self._write(b"\xC0\x00")

    async def _read_loop(self) -> None:
        while not self._stop_event.is_set():
            header, body = await self._read_packet()
            packet_type = header >> 4

            if packet_type != 3:
                continue

            if len(body) < 2:
                continue

            topic_len = int.from_bytes(body[:2], "big")
            cursor = 2
            if len(body) < cursor + topic_len:
                continue

            topic = body[
                cursor : cursor + topic_len
            ].decode("utf-8", errors="replace")
            cursor += topic_len

            qos = (header >> 1) & 0x03
            packet_id = None
            if qos:
                if len(body) < cursor + 2:
                    continue
                packet_id = int.from_bytes(
                    body[cursor : cursor + 2],
                    "big",
                )
                cursor += 2

            payload = body[cursor:]

            for callback in tuple(
                self._message_callbacks
            ):
                try:
                    result = callback(topic, payload)
                    if inspect.isawaitable(result):
                        asyncio.create_task(result)
                except Exception:
                    _LOGGER.exception(
                        "Aqara MQTT message callback failed"
                    )

            if qos == 1 and packet_id is not None:
                await self._write(
                    b"\x40\x02"
                    + packet_id.to_bytes(2, "big")
                )

    async def _read_packet(self) -> tuple[int, bytes]:
        if self._reader is None:
            raise ConnectionError(
                "MQTT reader is not available"
            )

        first = await self._reader.readexactly(1)
        header = first[0]

        multiplier = 1
        remaining = 0
        for _ in range(4):
            digit = (
                await self._reader.readexactly(1)
            )[0]
            remaining += (
                digit & 0x7F
            ) * multiplier
            if not digit & 0x80:
                break
            multiplier *= 128
        else:
            raise ValueError(
                "Malformed MQTT remaining length"
            )

        body = await self._reader.readexactly(
            remaining
        )
        return header, body

    async def _write(self, packet: bytes) -> None:
        async with self._write_lock:
            if self._writer is None:
                raise ConnectionError(
                    "MQTT writer is not available"
                )
            self._writer.write(packet)
            await self._writer.drain()

    async def _close_connection(self) -> None:
        self._set_connected(False)

        if self._ping_task:
            self._ping_task.cancel()
            self._ping_task = None

        writer = self._writer
        self._reader = None
        self._writer = None

        if writer:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    def _set_connected(self, connected: bool) -> None:
        if self.connected == connected:
            return

        self.connected = connected
        for callback in tuple(
            self._status_callbacks
        ):
            try:
                result = callback(connected)
                if inspect.isawaitable(result):
                    asyncio.create_task(result)
            except Exception:
                _LOGGER.exception(
                    "Aqara MQTT status callback failed"
                )

