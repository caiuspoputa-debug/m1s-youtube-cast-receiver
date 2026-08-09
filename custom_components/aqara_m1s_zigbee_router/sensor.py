from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Callable

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import LIGHT_LUX, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    DATA_CLIENTS,
    DATA_COORDINATORS,
    DOMAIN,
)


@dataclass
class SensorDef:
    key: str
    name: str
    command: str
    parser: Callable[[str], str | int | float | None]
    unit: str | None = None
    device_class: str | None = None


def last_number(text: str):
    values = re.findall(r"(?<![\d.])-?\d+(?:\.\d+)?", text)
    if not values:
        return None
    value = float(values[-1])
    return int(value) if value.is_integer() else value


def parse_temperature(text: str):
    # The M1S exposes its valid hub temperature through this Android property.
    # Ignore shell-echo numbers such as the "2" from 2>/dev/null and reject the
    # known bogus thermal-zone value of 1 °C.
    values = [float(value) for value in re.findall(r"(?<![\d.])-?\d+(?:\.\d+)?", text)]
    plausible = [value for value in values if 5 <= value <= 100]
    if not plausible:
        return None
    value = plausible[-1]
    return int(value) if value.is_integer() else round(value, 1)


def parse_wifi_ip(text: str):
    for address in re.findall(r"(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)", text):
        if not address.startswith("127.") and all(0 <= int(x) <= 255 for x in address.split(".")):
            return address
    return None


SENSORS = [
    SensorDef(
        "temperature",
        "Hub Temperature",
        "getprop persist.sys.temperature 2>/dev/null",
        parse_temperature,
        UnitOfTemperature.CELSIUS,
        SensorDeviceClass.TEMPERATURE,
    ),
    SensorDef("wifi_ip", "WiFi IP", "ifconfig wlan0 | grep 'inet addr'", parse_wifi_ip),
    SensorDef("homekit_process", "HomeKit Process", "ps w | grep homekitserver | grep -v grep",
              lambda value: "running" if "homekitserver" in value else "stopped"),
    SensorDef("mqtt_process", "MQTT Process", "ps w | grep mosquitto | grep -v grep",
              lambda value: "running" if "mosquitto" in value else "stopped"),
    SensorDef("telnet_process", "Telnet Process", "ps w | grep telnetd | grep -v grep",
              lambda value: "running" if "telnetd" in value else "stopped"),
    SensorDef("jn5189_router", "JN5189 Router", "cat /sys/class/gpio/gpio33/value; cat /sys/class/gpio/gpio18/value",
              lambda value: "running" if re.search(r"\b1\s+0\b", value.replace("\r", " ").replace("\n", " ")) else "check GPIO"),
]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    entity_registry = er.async_get(hass)
    obsolete_entity_id = entity_registry.async_get_entity_id(
        "sensor",
        DOMAIN,
        f"{entry.entry_id}_volume",
    )
    if obsolete_entity_id is not None:
        entity_registry.async_remove(obsolete_entity_id)

    obsolete_uptime_id = entity_registry.async_get_entity_id(
        "sensor",
        DOMAIN,
        f"{entry.entry_id}_uptime",
    )
    if obsolete_uptime_id is not None:
        entity_registry.async_remove(obsolete_uptime_id)

    client = hass.data[DOMAIN][DATA_CLIENTS][entry.entry_id]
    coordinator = hass.data[DOMAIN][DATA_COORDINATORS][entry.entry_id]
    entities = [
        AqaraM1SRouterSensor(hass, entry, client, coordinator, definition)
        for definition in SENSORS
    ]
    entities.append(AqaraM1SRouterIlluminanceSensor(entry, client, coordinator))
    async_add_entities(entities, True)


class AqaraM1SRouterSensor(CoordinatorEntity, SensorEntity):
    def __init__(self, hass, entry, client, coordinator, definition: SensorDef) -> None:
        super().__init__(coordinator)
        self.hass = hass
        self.entry = entry
        self.client = client
        self.definition = definition
        self._attr_name = definition.name
        self._attr_unique_id = f"{entry.entry_id}_{definition.key}"
        self._attr_native_unit_of_measurement = definition.unit
        self._attr_device_class = definition.device_class
        self._attr_device_info = {
            "identifiers": {(DOMAIN, client.host)},
            "name": entry.data.get("name", f"Aqara M1S Router {client.host}"),
            "manufacturer": "Aqara",
            "model": "M1S Gen 1 / JN5189 Router",
        }

    async def async_update(self) -> None:
        try:
            output = await self.hass.async_add_executor_job(
                self.client.run_command, self.definition.command
            )
            self._attr_native_value = self.definition.parser(output)
        except Exception:
            self._attr_native_value = None


class AqaraM1SRouterIlluminanceSensor(CoordinatorEntity, SensorEntity):
    _attr_name = "Illuminance"
    _attr_icon = "mdi:brightness-5"
    _attr_device_class = SensorDeviceClass.ILLUMINANCE
    _attr_native_unit_of_measurement = LIGHT_LUX
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, client, coordinator) -> None:
        super().__init__(coordinator)
        self.entry = entry
        self.client = client
        # Preserve the v0.1.3 unique ID so the existing registry entity is
        # upgraded in place instead of leaving a duplicate orphan.
        self._attr_unique_id = f"{entry.entry_id}_illuminance_raw"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, client.host)},
            "name": entry.data.get("name", f"Aqara M1S Router {client.host}"),
            "manufacturer": "Aqara",
            "model": "M1S Gen 1 / JN5189 Router",
        }
        self._apply_coordinator_data()

    def _apply_coordinator_data(self) -> None:
        data = self.coordinator.data or {}
        reading = data.get("illuminance")
        if not isinstance(reading, dict):
            self._attr_native_value = None
            self._attr_extra_state_attributes = {}
            return
        self._attr_native_value = reading.get("lux")
        self._attr_extra_state_attributes = {
            "adc_raw": reading.get("raw"),
            "millivolts": reading.get("millivolts"),
            "source": "JN5189 UART A6",
        }

    def _handle_coordinator_update(self) -> None:
        self._apply_coordinator_data()
        self.async_write_ha_state()
