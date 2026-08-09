from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import (
    CONF_HOST,
    CONF_PASSWORD,
    CONF_PORT,
    CONF_USERNAME,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    FileSelector,
    FileSelectorConfig,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import (
    DEFAULT_PASSWORD,
    DEFAULT_PORT,
    DEFAULT_USERNAME,
    DATA_CLIENTS,
    DATA_COORDINATORS,
    DOMAIN,
    MANAGED_SOUND_ROOT,
    sound_list_signal,
)
from .sound_upload import destination_for_filename, read_uploaded_sounds

_LOGGER = logging.getLogger(__name__)


class AqaraM1SZigbeeRouterConfigFlow(
    config_entries.ConfigFlow,
    domain=DOMAIN,
):
    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        return AqaraM1SZigbeeRouterOptionsFlow(config_entry)

    async def async_step_user(
        self,
        user_input=None,
    ):
        errors = {}

        if user_input is not None:
            await self.async_set_unique_id(
                user_input[CONF_HOST]
            )
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=(
                    user_input.get("name")
                    or (
                        "Aqara M1S "
                        f"{user_input[CONF_HOST]}"
                    )
                ),
                data=user_input,
            )

        schema = vol.Schema(
            {
                vol.Required(CONF_HOST): str,
                vol.Optional(
                    CONF_PORT,
                    default=DEFAULT_PORT,
                ): int,
                vol.Optional(
                    CONF_USERNAME,
                    default=DEFAULT_USERNAME,
                ): str,
                vol.Optional(
                    CONF_PASSWORD,
                    default=DEFAULT_PASSWORD,
                ): str,
                vol.Optional(
                    "name",
                    default="Aqara M1S Zigbee Router",
                ): str,
            }
        )

        return self.async_show_form(
            step_id="user",
            data_schema=schema,
            errors=errors,
        )


class AqaraM1SZigbeeRouterOptionsFlow(
    config_entries.OptionsFlowWithConfigEntry
):
    """Native file manager available from the integration Configure button."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        super().__init__(config_entry)

    @property
    def _client(self):
        return self.hass.data[DOMAIN][DATA_CLIENTS][self.config_entry.entry_id]

    async def async_step_init(self, user_input=None):
        menu_options = ["change_wifi", "upload_sound"]
        try:
            sounds = await self.hass.async_add_executor_job(
                self._client.list_sounds
            )
        except (OSError, RuntimeError):
            sounds = []
        if any(
            path.startswith(f"{MANAGED_SOUND_ROOT}/")
            for path in sounds
        ):
            menu_options.append("delete_sound")
        menu_options.extend(["rejoin_zigbee", "finish"])
        return self.async_show_menu(
            step_id="init",
            menu_options=menu_options,
        )


    async def async_step_change_wifi(self, user_input=None):
        """Safely test and apply a different Wi-Fi network on the hub."""
        errors = {}
        if user_input is not None:
            if not user_input.get("confirm", False):
                errors["base"] = "wifi_confirmation_required"
            else:
                try:
                    await self.hass.async_add_executor_job(
                        self._client.start_wifi_change,
                        user_input["ssid"],
                        user_input["wifi_password"],
                    )
                except ValueError:
                    errors["base"] = "wifi_invalid"
                except (OSError, RuntimeError, TimeoutError):
                    errors["base"] = "wifi_change_failed"
                else:
                    return self.async_abort(reason="wifi_change_started")

        return self.async_show_form(
            step_id="change_wifi",
            data_schema=vol.Schema(
                {
                    vol.Required("ssid"): TextSelector(
                        TextSelectorConfig(autocomplete="ssid")
                    ),
                    vol.Required("wifi_password"): TextSelector(
                        TextSelectorConfig(
                            type=TextSelectorType.PASSWORD,
                            autocomplete="new-password",
                        )
                    ),
                    vol.Required("confirm", default=False): BooleanSelector(),
                }
            ),
            errors=errors,
        )

    async def async_step_finish(self, user_input=None):
        """Close sound management and reload the config entry."""
        await self.hass.config_entries.async_reload(
            self.config_entry.entry_id
        )
        return self.async_create_entry(title="", data={})

    async def async_step_upload_sound(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                uploads = await self.hass.async_add_executor_job(
                    read_uploaded_sounds,
                    self.hass,
                    user_input["source"],
                )
                for filename, content in uploads:
                    destination = destination_for_filename(filename)
                    await self.hass.async_add_executor_job(
                        self._client.upload_sound,
                        destination,
                        content,
                    )
            except (OSError, ValueError, RuntimeError) as err:
                _LOGGER.exception("WAV upload failed: %s", err)
                errors["base"] = "upload_failed"
            else:
                async_dispatcher_send(
                    self.hass,
                    sound_list_signal(self.config_entry.entry_id),
                )
                coordinator = self.hass.data[DOMAIN][DATA_COORDINATORS].get(
                    self.config_entry.entry_id
                )
                if coordinator is not None:
                    await coordinator.async_request_refresh()
                return await self.async_step_init()

        return self.async_show_form(
            step_id="upload_sound",
            data_schema=vol.Schema(
                {
                    vol.Required("source"): FileSelector(
                        FileSelectorConfig(accept="audio/wav,.wav,application/zip,.zip")
                    )
                }
            ),
            errors=errors,
        )

    async def async_step_delete_sound(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                selected_paths = user_input["path"]
                if isinstance(selected_paths, str):
                    selected_paths = [selected_paths]
                for path in selected_paths:
                    await self.hass.async_add_executor_job(
                        self._client.delete_sound,
                        path,
                    )
            except (OSError, ValueError, RuntimeError):
                errors["base"] = "delete_failed"
            else:
                async_dispatcher_send(
                    self.hass,
                    sound_list_signal(self.config_entry.entry_id),
                )
                coordinator = self.hass.data[DOMAIN][DATA_COORDINATORS].get(
                    self.config_entry.entry_id
                )
                if coordinator is not None:
                    await coordinator.async_request_refresh()
                return await self.async_step_init()

        try:
            sounds = await self.hass.async_add_executor_job(
                self._client.list_sounds
            )
        except (OSError, RuntimeError):
            sounds = []
        managed_sounds = [
            path
            for path in sounds
            if path.startswith(f"{MANAGED_SOUND_ROOT}/")
        ]
        if not managed_sounds:
            return await self.async_step_init()

        return self.async_show_form(
            step_id="delete_sound",
            data_schema=vol.Schema(
                {
                    vol.Required("path"): SelectSelector(
                        SelectSelectorConfig(
                            options=managed_sounds,
                            multiple=True,
                            mode=SelectSelectorMode.DROPDOWN,
                        )
                    )
                }
            ),
            errors=errors,
        )

    async def async_step_rejoin_zigbee(self, user_input=None):
        """Move the JN5189 router to a different Zigbee coordinator."""
        errors = {}
        if user_input is not None:
            if not user_input.get("confirm", False):
                errors["base"] = "rejoin_confirmation_required"
            else:
                try:
                    await self.hass.async_add_executor_job(
                        self._client.rejoin_zigbee_network
                    )
                except (OSError, RuntimeError):
                    errors["base"] = "rejoin_failed"
                else:
                    return self.async_create_entry(title="", data={})

        return self.async_show_form(
            step_id="rejoin_zigbee",
            data_schema=vol.Schema(
                {
                    vol.Required("confirm", default=False): BooleanSelector(),
                }
            ),
            errors=errors,
        )
