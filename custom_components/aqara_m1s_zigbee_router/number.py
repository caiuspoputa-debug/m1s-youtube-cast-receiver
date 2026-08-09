from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    DATA_CLIENTS,
    DATA_COORDINATORS,
    DATA_PLAYBACK_VOLUME,
    DATA_RADIO_PLAYERS,
    DOMAIN,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN].setdefault(DATA_PLAYBACK_VOLUME, {})

    client = hass.data[DOMAIN][DATA_CLIENTS][entry.entry_id]
    coordinator = hass.data[DOMAIN][DATA_COORDINATORS][entry.entry_id]

    radio_player = hass.data[DOMAIN][DATA_RADIO_PLAYERS][entry.entry_id]

    async_add_entities(
        [
            AqaraM1SSoundPlaybackVolume(
                hass,
                entry,
                client,
                coordinator,
            ),
            AqaraM1SRadioFineVolumeTrim(
                hass,
                entry,
                client,
                coordinator,
                radio_player,
            ),
        ]
    )


class AqaraM1SSoundPlaybackVolume(
    CoordinatorEntity,
    RestoreEntity,
    NumberEntity,
):
    """Volume used by local Aqara WAV/sound playback commands."""

    _attr_name = "Sound Playback Volume"
    _attr_icon = "mdi:volume-high"
    _attr_native_min_value = 1
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_mode = NumberMode.SLIDER
    _attr_should_poll = False

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client,
        coordinator,
    ) -> None:
        CoordinatorEntity.__init__(self, coordinator)
        self.hass = hass
        self.entry = entry
        self.client = client

        self._attr_unique_id = f"{entry.entry_id}_sound_playback_volume"
        self._attr_native_value = 50
        self._attr_device_info = {
            "identifiers": {(DOMAIN, self.client.host)},
            "name": entry.data.get(
                "name",
                f"Aqara M1S {self.client.host}",
            ),
            "manufacturer": "Aqara",
            "model": "M1S Gen 1 / JN5189 Router",
        }

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()

        restored = await self.async_get_last_state()
        value = None
        if restored is not None:
            try:
                value = int(float(restored.state))
            except (TypeError, ValueError):
                value = None
        if value is None:
            value = 50

        value = max(1, min(100, value))
        self._attr_native_value = value
        self.hass.data.setdefault(DOMAIN, {})
        self.hass.data[DOMAIN].setdefault(DATA_PLAYBACK_VOLUME, {})
        self.hass.data[DOMAIN][DATA_PLAYBACK_VOLUME][self.entry.entry_id] = value
        self.async_write_ha_state()

    async def async_set_native_value(self, value: float) -> None:
        safe_value = max(1, min(100, int(round(value))))
        self._attr_native_value = safe_value
        self.hass.data.setdefault(DOMAIN, {})
        self.hass.data[DOMAIN].setdefault(DATA_PLAYBACK_VOLUME, {})
        self.hass.data[DOMAIN][DATA_PLAYBACK_VOLUME][self.entry.entry_id] = safe_value
        self.async_write_ha_state()


class AqaraM1SRadioFineVolumeTrim(
    CoordinatorEntity,
    RestoreEntity,
    NumberEntity,
):
    """Fine absolute trim for one individual media player's live PCM gain."""

    _attr_name = "Fine Volume Trim"
    _attr_icon = "mdi:tune-vertical"
    _attr_native_min_value = -1.0
    _attr_native_max_value = 1.0
    _attr_native_step = 0.01
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_mode = NumberMode.SLIDER
    _attr_should_poll = False

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client,
        coordinator,
        radio_player,
    ) -> None:
        CoordinatorEntity.__init__(self, coordinator)
        self.hass = hass
        self.entry = entry
        self.client = client
        self.radio_player = radio_player

        # Deliberately use a new unique ID. Older releases used
        # *_radio_fine_volume for a different absolute-volume control.
        self._attr_unique_id = f"{entry.entry_id}_radio_fine_trim"
        self._attr_native_value = 0.0
        self._attr_device_info = {
            "identifiers": {(DOMAIN, self.client.host)},
            "name": entry.data.get(
                "name",
                f"Aqara M1S {self.client.host}",
            ),
            "manufacturer": "Aqara",
            "model": "M1S Gen 1 / JN5189 Router",
        }

    @staticmethod
    def _normalize(value: float) -> float:
        value = max(-1.0, min(1.0, float(value)))
        return round(round(value / 0.01) * 0.01, 2)

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()

        restored = await self.async_get_last_state()
        value = 0.0
        if restored is not None:
            try:
                value = float(restored.state)
            except (TypeError, ValueError):
                value = 0.0

        value = self._normalize(value)
        self._attr_native_value = value
        self.radio_player.set_fine_volume_trim_percent(value)
        self.async_write_ha_state()

    async def async_set_native_value(self, value: float) -> None:
        safe_value = self._normalize(value)
        self._attr_native_value = safe_value
        self.radio_player.set_fine_volume_trim_percent(safe_value)
        self.async_write_ha_state()
