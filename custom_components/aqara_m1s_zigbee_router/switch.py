from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DATA_CLIENTS, DATA_MEDIA_GROUP, DOMAIN


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    client = hass.data[DOMAIN][DATA_CLIENTS][entry.entry_id]
    manager = hass.data[DOMAIN][DATA_MEDIA_GROUP]
    async_add_entities([AqaraM1SMediaGroupMemberSwitch(entry, client, manager)])


class AqaraM1SMediaGroupMemberSwitch(SwitchEntity, RestoreEntity):
    """Include or exclude one hub from the shared media group."""

    _attr_name = "Include in M1S Media Group"
    _attr_icon = "mdi:speaker-multiple"
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, client, manager) -> None:
        self.entry = entry
        self.client = client
        self.manager = manager
        self._attr_unique_id = f"{entry.entry_id}_media_group_member"
        self._attr_is_on = True
        self._attr_device_info = {
            "identifiers": {(DOMAIN, client.host)},
            "name": entry.data.get("name", f"Aqara M1S {client.host}"),
            "manufacturer": "Aqara",
            "model": "M1S Gen 1 / JN5189 Router",
        }

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last = await self.async_get_last_state()
        self._attr_is_on = last is None or last.state == "on"
        self.manager.set_selected(self.entry.entry_id, self._attr_is_on)
        self.async_write_ha_state()

    async def async_turn_on(self, **kwargs) -> None:
        self._attr_is_on = True
        self.async_write_ha_state()
        await self.manager.async_member_enabled(self.entry.entry_id)

    async def async_turn_off(self, **kwargs) -> None:
        self._attr_is_on = False
        self.async_write_ha_state()
        await self.manager.async_member_disabled(self.entry.entry_id)
