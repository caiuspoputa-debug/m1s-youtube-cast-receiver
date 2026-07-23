from __future__ import annotations

from urllib.parse import urlparse

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import (
    CONF_NAME,
    CONF_STATIONS,
    DEFAULT_NAME,
    DEFAULT_STATIONS,
    DOMAIN,
)


def _valid_stream_url(value: str) -> str:
    value = value.strip()
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise vol.Invalid("A complete HTTP or HTTPS stream URL is required")
    return value


class RadioFavoritesConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        return RadioFavoritesOptionsFlow()

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=user_input[CONF_NAME],
                data={CONF_NAME: user_input[CONF_NAME]},
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {vol.Required(CONF_NAME, default=DEFAULT_NAME): str}
            ),
            errors=errors,
        )


class RadioFavoritesOptionsFlow(config_entries.OptionsFlow):
    """Edit several stations in one session and save only on Finish."""

    def __init__(self) -> None:
        self._stations: dict[str, str] | None = None

    async def async_step_init(self, user_input=None):
        if self._stations is None:
            configured = self.config_entry.options.get(CONF_STATIONS)
            source = configured if configured is not None else DEFAULT_STATIONS
            self._stations = dict(source)
        options = ["add_station"]
        if self._stations:
            options.append("delete_station")
        options.append("finish")
        return self.async_show_menu(step_id="init", menu_options=options)

    async def async_step_add_station(self, user_input=None):
        assert self._stations is not None
        errors = {}
        if user_input is not None:
            name = user_input["station_name"].strip()
            if not name:
                errors["station_name"] = "name_required"
            else:
                self._stations[name] = user_input["stream_url"]
                return await self.async_step_init()

        return self.async_show_form(
            step_id="add_station",
            data_schema=vol.Schema(
                {
                    vol.Required("station_name"): str,
                    vol.Required("stream_url"): _valid_stream_url,
                }
            ),
            errors=errors,
        )

    async def async_step_delete_station(self, user_input=None):
        assert self._stations is not None
        if user_input is not None:
            self._stations.pop(user_input["station_name"], None)
            return await self.async_step_init()

        if not self._stations:
            return await self.async_step_init()

        return self.async_show_form(
            step_id="delete_station",
            data_schema=vol.Schema(
                {
                    vol.Required("station_name"): SelectSelector(
                        SelectSelectorConfig(
                            options=sorted(self._stations, key=str.casefold),
                            mode=SelectSelectorMode.DROPDOWN,
                        )
                    )
                }
            ),
        )

    async def async_step_finish(self, user_input=None):
        assert self._stations is not None
        return self.async_create_entry(
            title="",
            data={CONF_STATIONS: self._stations},
        )
