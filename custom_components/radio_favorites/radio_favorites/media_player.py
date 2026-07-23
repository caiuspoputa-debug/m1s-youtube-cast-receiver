from __future__ import annotations

from typing import Any

from homeassistant.components.media_player import (
    MediaPlayerDeviceClass,
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import (
    CONF_NAME,
    DATA_MANAGERS,
    DEFAULT_NAME,
    DOMAIN,
    SIGNAL_STATIONS_UPDATED,
    SIGNAL_TARGET_UPDATED,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    manager = hass.data[DOMAIN][DATA_MANAGERS][entry.entry_id]
    async_add_entities([RadioFavoritesPlayer(entry, manager)])


class RadioFavoritesPlayer(RestoreEntity, MediaPlayerEntity):
    _attr_name = "Radio Favorites"
    _attr_device_class = MediaPlayerDeviceClass.SPEAKER
    _attr_should_poll = False
    _attr_supported_features = (
        MediaPlayerEntityFeature.SELECT_SOURCE
        | MediaPlayerEntityFeature.PLAY
        | MediaPlayerEntityFeature.STOP
        | MediaPlayerEntityFeature.TURN_OFF
        | MediaPlayerEntityFeature.VOLUME_SET
        | MediaPlayerEntityFeature.VOLUME_MUTE
    )

    def __init__(self, entry: ConfigEntry, manager) -> None:
        self.entry = entry
        self.manager = manager
        self._attr_unique_id = f"{entry.entry_id}_player"
        self._attr_state = MediaPlayerState.IDLE
        self._attr_source = manager.selected_station
        self._attr_media_title = manager.selected_station
        self._attr_media_content_type = "music"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": entry.data.get(CONF_NAME, DEFAULT_NAME),
            "manufacturer": "Caius Poputa",
            "model": "Radio Favorites",
        }

    @property
    def source_list(self) -> list[str]:
        return self.manager.station_names

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        station = self.manager.selected_station
        return {
            "target_media_player": self.manager.target_entity_id,
            "station_url": self.manager.stations.get(station) if station else None,
        }

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.manager.proxy_entity_id = self.entity_id
        restored = await self.async_get_last_state()
        if restored is not None:
            source = restored.attributes.get("source")
            if source in self.manager.stations:
                self.manager.selected_station = source
                self._attr_source = source
                self._attr_media_title = source
        self.async_on_remove(
            self.hass.bus.async_listen(
                EVENT_STATE_CHANGED,
                self._handle_state_changed,
            )
        )
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                f"{SIGNAL_STATIONS_UPDATED}_{self.entry.entry_id}",
                self._handle_stations_updated,
            )
        )
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                f"{SIGNAL_TARGET_UPDATED}_{self.entry.entry_id}",
                self._handle_target_updated,
            )
        )
        self._sync_target_state()

    @callback
    def _handle_state_changed(self, event: Event) -> None:
        if event.data.get("entity_id") != self.manager.target_entity_id:
            return
        self._sync_target_state()
        self.async_write_ha_state()

    @callback
    def _handle_stations_updated(self) -> None:
        self._attr_source = self.manager.selected_station
        self._attr_media_title = self.manager.selected_station
        self.async_write_ha_state()

    @callback
    def _handle_target_updated(self) -> None:
        self._sync_target_state()
        self.async_write_ha_state()

    def _sync_target_state(self) -> None:
        target = (
            self.hass.states.async_get(self.manager.target_entity_id)
            if self.manager.target_entity_id
            else None
        )
        if target is None:
            self._attr_state = MediaPlayerState.IDLE
            return
        try:
            self._attr_state = MediaPlayerState(target.state)
        except ValueError:
            self._attr_state = MediaPlayerState.IDLE
        self._attr_volume_level = target.attributes.get("volume_level")
        self._attr_is_volume_muted = target.attributes.get("is_volume_muted")

    async def async_select_source(self, source: str) -> None:
        await self.manager.async_select_and_play(source)
        self._attr_source = source
        self._attr_media_title = source
        self._sync_target_state()
        self.async_write_ha_state()

    async def async_media_play(self) -> None:
        await self.manager.async_play()
        self._sync_target_state()
        self.async_write_ha_state()

    async def async_media_stop(self) -> None:
        await self.manager.async_stop()
        self._sync_target_state()
        self.async_write_ha_state()

    async def async_turn_off(self) -> None:
        await self.manager.async_turn_off()
        self._sync_target_state()
        self.async_write_ha_state()

    async def async_set_volume_level(self, volume: float) -> None:
        await self.manager.async_set_volume(volume)
        self._attr_volume_level = max(0.0, min(1.0, float(volume)))
        self.async_write_ha_state()

    async def async_mute_volume(self, mute: bool) -> None:
        await self.manager.async_set_muted(mute)
        self._attr_is_volume_muted = bool(mute)
        self.async_write_ha_state()
