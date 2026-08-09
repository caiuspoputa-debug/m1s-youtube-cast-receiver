from __future__ import annotations

from homeassistant.components.light import ATTR_BRIGHTNESS, ATTR_RGB_COLOR, ColorMode, LightEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DATA_CLIENTS, DATA_COORDINATORS, DOMAIN


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([
        AqaraM1SRouterRingLight(
            hass,
            entry,
            hass.data[DOMAIN][DATA_CLIENTS][entry.entry_id],
            hass.data[DOMAIN][DATA_COORDINATORS][entry.entry_id],
        )
    ])


class AqaraM1SRouterRingLight(CoordinatorEntity, RestoreEntity, LightEntity):
    _attr_name = "Ring Light"
    _attr_supported_color_modes = {ColorMode.RGB}
    _attr_color_mode = ColorMode.RGB
    _attr_should_poll = False

    def __init__(self, hass, entry, client, coordinator) -> None:
        super().__init__(coordinator)
        self.hass = hass
        self.entry = entry
        self.client = client
        self._attr_unique_id = f"{entry.entry_id}_ring_light"
        self._attr_is_on = False
        self._attr_brightness = 64
        self._attr_rgb_color = (255, 0, 0)
        self._online_generation = (coordinator.data or {}).get(
            "online_generation", 0
        )
        self._attr_device_info = {
            "identifiers": {(DOMAIN, client.host)},
            "name": entry.data.get("name", f"Aqara M1S Router {client.host}"),
            "manufacturer": "Aqara",
            "model": "M1S Gen 1 / JN5189 Router",
        }

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        restored = await self.async_get_last_state()
        if restored is not None:
            if restored.attributes.get("brightness") is not None:
                self._attr_brightness = int(restored.attributes["brightness"])
            rgb = restored.attributes.get("rgb_color")
            if rgb and len(rgb) == 3:
                self._attr_rgb_color = tuple(int(value) for value in rgb)
        # Setup physically turns off the red boot light. Restore only the last
        # chosen color and brightness, never a stale ON state.
        self._attr_is_on = False

    def _handle_coordinator_update(self) -> None:
        generation = (self.coordinator.data or {}).get(
            "online_generation", 0
        )
        if generation != self._online_generation:
            self._online_generation = generation
            self._attr_is_on = False
        super()._handle_coordinator_update()

    async def async_turn_on(self, **kwargs) -> None:
        if ATTR_RGB_COLOR in kwargs:
            self._attr_rgb_color = tuple(int(v) for v in kwargs[ATTR_RGB_COLOR])
        if ATTR_BRIGHTNESS in kwargs:
            self._attr_brightness = max(1, min(255, int(kwargs[ATTR_BRIGHTNESS])))
        brightness = self._attr_brightness or 255
        red, green, blue = self._attr_rgb_color or (255, 255, 255)
        await self.hass.async_add_executor_job(
            self.client.set_rgb,
            round(red * brightness / 255),
            round(green * brightness / 255),
            round(blue * brightness / 255),
        )
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        await self.hass.async_add_executor_job(self.client.set_rgb, 0, 0, 0)
        self._attr_is_on = False
        self.async_write_ha_state()
