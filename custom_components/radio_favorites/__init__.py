from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import DATA_MANAGERS, DOMAIN, SIGNAL_STATIONS_UPDATED
from .manager import RadioFavoritesManager

PLATFORMS = ["media_player", "select"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN].setdefault(DATA_MANAGERS, {})
    hass.data[DOMAIN][DATA_MANAGERS][entry.entry_id] = RadioFavoritesManager(
        hass, entry
    )

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def _async_options_updated(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    manager = hass.data[DOMAIN][DATA_MANAGERS][entry.entry_id]
    manager.update_stations()
    async_dispatcher_send(
        hass,
        f"{SIGNAL_STATIONS_UPDATED}_{entry.entry_id}",
    )


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    hass.data[DOMAIN][DATA_MANAGERS].pop(entry.entry_id, None)
    return True

