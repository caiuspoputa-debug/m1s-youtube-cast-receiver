from __future__ import annotations

from dataclasses import dataclass, field

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .const import CONF_STATIONS, DEFAULT_STATIONS


@dataclass
class RadioFavoritesManager:
    """Shared station catalogue and selected output player."""

    hass: HomeAssistant
    entry: ConfigEntry
    stations: dict[str, str] = field(default_factory=dict)
    target_entity_id: str | None = None
    selected_station: str | None = None
    proxy_entity_id: str | None = None

    def __post_init__(self) -> None:
        self.update_stations()

    def update_stations(self) -> None:
        configured = self.entry.options.get(CONF_STATIONS)
        source = configured if configured is not None else DEFAULT_STATIONS
        self.stations = {
            str(name): str(url)
            for name, url in dict(source).items()
            if str(name).strip() and str(url).strip()
        }
        if self.selected_station not in self.stations:
            self.selected_station = next(iter(self.stations), None)

    @property
    def station_names(self) -> list[str]:
        return sorted(self.stations, key=str.casefold)

    @property
    def target_choices(self) -> dict[str, str]:
        entities = self.hass.states.async_entity_ids("media_player")
        choices = {}
        for entity_id in entities:
            if entity_id == self.proxy_entity_id:
                continue
            state = self.hass.states.async_get(entity_id)
            friendly_name = (
                state.attributes.get("friendly_name", entity_id)
                if state is not None
                else entity_id
            )
            choices[f"{friendly_name} — {entity_id}"] = entity_id
        return dict(sorted(choices.items(), key=lambda item: item[0].casefold()))

    @property
    def target_options(self) -> list[str]:
        return list(self.target_choices)

    def option_for_target(self, entity_id: str | None) -> str | None:
        for option, candidate in self.target_choices.items():
            if candidate == entity_id:
                return option
        return None

    def set_target(self, entity_id: str | None) -> None:
        self.target_entity_id = entity_id

    def _require_target(self) -> str:
        if not self.target_entity_id:
            raise HomeAssistantError(
                "Select a target media player before playing a station"
            )
        if self.hass.states.async_get(self.target_entity_id) is None:
            raise HomeAssistantError(
                f"Target media player {self.target_entity_id} does not exist"
            )
        return self.target_entity_id

    async def async_select_and_play(self, station: str) -> None:
        if station not in self.stations:
            raise HomeAssistantError(f"Unknown radio station: {station}")
        self.selected_station = station
        await self.async_play()

    async def async_play(self) -> None:
        target = self._require_target()
        if not self.selected_station:
            raise HomeAssistantError("Add and select a radio station first")
        url = self.stations.get(self.selected_station)
        if not url:
            raise HomeAssistantError(
                f"No stream URL configured for {self.selected_station}"
            )
        await self.hass.services.async_call(
            "media_player",
            "play_media",
            {
                "media_content_id": url,
                "media_content_type": "music",
                "enqueue": "replace",
            },
            target={"entity_id": target},
            blocking=True,
        )

    async def async_stop(self) -> None:
        await self.hass.services.async_call(
            "media_player",
            "media_stop",
            {},
            target={"entity_id": self._require_target()},
            blocking=True,
        )

    async def async_turn_off(self) -> None:
        await self.hass.services.async_call(
            "media_player",
            "turn_off",
            {},
            target={"entity_id": self._require_target()},
            blocking=True,
        )

    async def async_set_volume(self, volume: float) -> None:
        await self.hass.services.async_call(
            "media_player",
            "volume_set",
            {"volume_level": max(0.0, min(1.0, float(volume)))},
            target={"entity_id": self._require_target()},
            blocking=True,
        )

    async def async_set_muted(self, muted: bool) -> None:
        await self.hass.services.async_call(
            "media_player",
            "volume_mute",
            {"is_volume_muted": bool(muted)},
            target={"entity_id": self._require_target()},
            blocking=True,
        )
