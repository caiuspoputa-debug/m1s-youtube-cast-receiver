from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import (
    CONF_NAME,
    DATA_MANAGERS,
    DEFAULT_NAME,
    DOMAIN,
    SIGNAL_TARGET_UPDATED,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    manager = hass.data[DOMAIN][DATA_MANAGERS][entry.entry_id]
    async_add_entities([RadioFavoritesTargetSelect(entry, manager)])


class RadioFavoritesTargetSelect(RestoreEntity, SelectEntity):
    _attr_name = "Target Media Player"
    _attr_icon = "mdi:speaker-multiple"

    def __init__(self, entry: ConfigEntry, manager) -> None:
        self.entry = entry
        self.manager = manager
        self._attr_unique_id = f"{entry.entry_id}_target_player"
        self._attr_current_option = None
        self._known_options: list[str] = []
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": entry.data.get(CONF_NAME, DEFAULT_NAME),
            "manufacturer": "Caius Poputa",
            "model": "Radio Favorites",
        }

    @property
    def options(self) -> list[str]:
        return self.manager.target_options

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._known_options = self.options
        restored = await self.async_get_last_state()
        if restored is not None and restored.state in self._known_options:
            self._attr_current_option = restored.state
        else:
            self._attr_current_option = self.manager.option_for_target(
                self.manager.target_entity_id
            )
        self.manager.set_target(
            self.manager.target_choices.get(self._attr_current_option)
        )
        async_dispatcher_send(
            self.hass,
            f"{SIGNAL_TARGET_UPDATED}_{self.entry.entry_id}",
        )
        self.async_on_remove(
            self.hass.bus.async_listen(
                EVENT_STATE_CHANGED,
                self._handle_state_changed,
            )
        )

    @callback
    def _handle_state_changed(self, event: Event) -> None:
        entity_id = event.data.get("entity_id", "")
        if not entity_id.startswith("media_player."):
            return
        options = self.options
        if options == self._known_options:
            return
        self._known_options = options
        if self._attr_current_option not in options:
            self._attr_current_option = None
            self.manager.set_target(None)
            async_dispatcher_send(
                self.hass,
                f"{SIGNAL_TARGET_UPDATED}_{self.entry.entry_id}",
            )
        self.async_write_ha_state()

    async def async_select_option(self, option: str) -> None:
        if option not in self.options:
            raise ValueError(f"Unknown media player: {option}")
        self._attr_current_option = option
        self.manager.set_target(self.manager.target_choices[option])
        async_dispatcher_send(
            self.hass,
            f"{SIGNAL_TARGET_UPDATED}_{self.entry.entry_id}",
        )
        self.async_write_ha_state()
