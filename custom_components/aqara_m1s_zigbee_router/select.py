from __future__ import annotations

from pathlib import PurePosixPath

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.entity import EntityCategory

from .const import DOMAIN, DATA_CLIENTS, DATA_SELECTED_SOUND, DATA_SOUND_MAP


FALLBACK_SOUNDS = [
    "/data/musics/music-scene/door_bell_1.wav",
    "/data/musics/music-scene/alarm.wav",
    "/data/musics/music-scene/arm_ok.wav",
    "/data/musics/music-scene/disarm.wav",
]


def label_for_path(path: str) -> str:
    p = PurePosixPath(path)
    return f"{p.parent.name} / {p.name}"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback):
    client = hass.data[DOMAIN][DATA_CLIENTS][entry.entry_id]
    sounds = await hass.async_add_executor_job(client.list_sounds)
    if not sounds:
        sounds = FALLBACK_SOUNDS

    labels = []
    mapping = {}
    for path in sounds:
        label = label_for_path(path)
        if label in mapping:
            label = path
        labels.append(label)
        mapping[label] = path

    hass.data[DOMAIN][DATA_SOUND_MAP][entry.entry_id] = mapping
    async_add_entities([AqaraM1SSoundSelect(hass, entry, client, labels, mapping)])


class AqaraM1SSoundSelect(SelectEntity):
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client, labels: list[str], mapping: dict[str, str]):
        self.hass = hass
        self.entry = entry
        self.client = client
        self._labels = labels
        self._mapping = mapping
        self._attr_name = "Sound"
        self._attr_unique_id = f"{entry.entry_id}_sound_select"
        self._attr_options = labels
        self._attr_current_option = labels[0]
        hass.data[DOMAIN][DATA_SELECTED_SOUND][entry.entry_id] = mapping[labels[0]]
        self._attr_device_info = {
            "identifiers": {(DOMAIN, self.client.host)},
            "name": entry.data.get("name", f"Aqara M1S {self.client.host}"),
            "manufacturer": "Aqara",
            "model": "M1S Gen 1 / JN5189 Router",
        }

    async def async_select_option(self, option: str) -> None:
        if option not in self._mapping:
            return
        self._attr_current_option = option
        self.hass.data[DOMAIN][DATA_SELECTED_SOUND][self.entry.entry_id] = self._mapping[option]
        self.async_write_ha_state()
