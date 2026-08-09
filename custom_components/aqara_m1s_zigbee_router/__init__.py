from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    CONF_HOST,
    CONF_PASSWORD,
    CONF_PORT,
    CONF_USERNAME,
)
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .client import AqaraM1SClient
from .const import (
    DATA_CLIENTS,
    DATA_COORDINATORS,
    DATA_PLAYBACK_VOLUME,
    DATA_RADIO_PLAYERS,
    DATA_MEDIA_GROUP,
    DATA_SOUND_PLAYERS,
    DEFAULT_PASSWORD,
    DEFAULT_PORT,
    DEFAULT_USERNAME,
    DOMAIN,
    SERVICE_PLAY_SOUND,
    SERVICE_PLAY_URL,
    SERVICE_RUN_COMMAND,
    SERVICE_UPLOAD_SOUND,
    SERVICE_DELETE_SOUND,
    SERVICE_REFRESH_SOUNDS,
    sound_list_signal,
)
from .coordinator import AqaraM1SRouterCoordinator
from .media_group import AqaraM1SMediaGroupManager
from .media_player import AqaraM1SRadioPlayer
from .sound_player import AqaraM1SSoundPlayer
from .sound_upload import destination_for_filename, read_uploaded_sound

PLATFORMS = [
    "button",
    "event",
    "light",
    "media_player",
    "number",
    "sensor",
    "switch",
]



async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    host = entry.data[CONF_HOST]
    port = entry.data.get(CONF_PORT, DEFAULT_PORT)
    username = entry.data.get(
        CONF_USERNAME,
        DEFAULT_USERNAME,
    )
    password = entry.data.get(
        CONF_PASSWORD,
        DEFAULT_PASSWORD,
    )

    client = AqaraM1SClient(
        host=host,
        port=port,
        username=username,
        password=password,
    )
    coordinator = AqaraM1SRouterCoordinator(hass, client)

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN].setdefault(DATA_CLIENTS, {})
    hass.data[DOMAIN].setdefault(
        DATA_COORDINATORS,
        {},
    )
    hass.data[DOMAIN].setdefault(
        DATA_PLAYBACK_VOLUME,
        {},
    )
    hass.data[DOMAIN].setdefault(
        DATA_RADIO_PLAYERS,
        {},
    )
    hass.data[DOMAIN].setdefault(
        DATA_SOUND_PLAYERS,
        {},
    )
    if DATA_MEDIA_GROUP not in hass.data[DOMAIN]:
        hass.data[DOMAIN][DATA_MEDIA_GROUP] = AqaraM1SMediaGroupManager(hass)

    hass.data[DOMAIN][DATA_CLIENTS][
        entry.entry_id
    ] = client
    hass.data[DOMAIN][DATA_COORDINATORS][
        entry.entry_id
    ] = coordinator
    hass.data[DOMAIN][DATA_PLAYBACK_VOLUME][
        entry.entry_id
    ] = 50
    hass.data[DOMAIN][DATA_SOUND_PLAYERS][entry.entry_id] = AqaraM1SSoundPlayer(
        hass, client
    )
    radio_player = AqaraM1SRadioPlayer(
        hass, entry, client, coordinator
    )
    hass.data[DOMAIN][DATA_RADIO_PLAYERS][entry.entry_id] = radio_player
    group_manager = hass.data[DOMAIN][DATA_MEDIA_GROUP]
    group_manager.register_member(
        entry.entry_id,
        entry.data.get("name", f"Aqara M1S {host}"),
        client,
        coordinator,
    )
    radio_player.set_group_manager(group_manager)

    device_registry = dr.async_get(hass)
    device_registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, host)},
        name=entry.data.get(
            "name",
            f"Aqara M1S Router {host}",
        ),
        manufacturer="Aqara",
        model="M1S Gen 1 / JN5189 Router",
    )

    entity_registry = er.async_get(hass)
    obsolete_select_id = entity_registry.async_get_entity_id(
        "select",
        DOMAIN,
        f"{entry.entry_id}_sound_select",
    )
    if obsolete_select_id is not None:
        entity_registry.async_remove(obsolete_select_id)

    # Remove the legacy absolute fine-volume Number entities from v0.5.0-v0.5.5.
    # v0.5.9 reintroduces only an individual *trim* control with a new unique ID
    # (*_radio_fine_trim), so the old entity must not be revived accidentally.
    obsolete_number_unique_ids = (
        f"{entry.entry_id}_radio_fine_volume",
        "aqara_m1s_media_group_fine_volume",
    )
    for unique_id in obsolete_number_unique_ids:
        obsolete_number_id = entity_registry.async_get_entity_id(
            "number", DOMAIN, unique_id
        )
        if obsolete_number_id is not None:
            entity_registry.async_remove(obsolete_number_id)

    await coordinator.async_config_entry_first_refresh()
    await hass.config_entries.async_forward_entry_setups(
        entry,
        PLATFORMS,
    )

    async def _get_target(
        call: ServiceCall,
    ) -> tuple[str, AqaraM1SClient]:
        call_host = call.data.get("host")
        if call_host:
            for configured_entry_id, configured_client in hass.data[
                DOMAIN
            ][DATA_CLIENTS].items():
                if configured_client.host == call_host:
                    return configured_entry_id, configured_client
            return entry.entry_id, AqaraM1SClient(
                host=call_host,
                port=call.data.get(
                    "port",
                    DEFAULT_PORT,
                ),
                username=call.data.get(
                    "username",
                    DEFAULT_USERNAME,
                ),
                password=call.data.get(
                    "password",
                    DEFAULT_PASSWORD,
                ),
            )
        return entry.entry_id, hass.data[DOMAIN][DATA_CLIENTS][entry.entry_id]

    async def play_url(call: ServiceCall) -> None:
        _, selected_client = await _get_target(call)
        url = call.data["url"]
        command = (
            f'wget -q "{url}" '
            "-O /tmp/ha_audio.wav "
            "&& (aplay -x 1 /tmp/ha_audio.wav & "
            "APID=$!; renice -3 -p \"$APID\" "
            ">/tmp/aqara_m1s_play_url_aplay_renice.log 2>&1 || true; "
            "wait \"$APID\")"
        )
        await hass.async_add_executor_job(
            selected_client.run_command,
            command,
        )

    async def play_sound(
        call: ServiceCall,
    ) -> None:
        selected_entry_id, selected_client = await _get_target(call)
        path = call.data["path"]
        sound_player = hass.data[DOMAIN][DATA_SOUND_PLAYERS][selected_entry_id]
        await sound_player.async_play(
            path,
            hass.data[DOMAIN][DATA_PLAYBACK_VOLUME].get(selected_entry_id, 50),
        )

    async def run_command(
        call: ServiceCall,
    ) -> None:
        _, selected_client = await _get_target(call)
        await hass.async_add_executor_job(
            selected_client.run_command,
            call.data["command"],
        )

    async def upload_sound(call: ServiceCall) -> None:
        selected_entry_id, selected_client = await _get_target(call)
        source = call.data["source"]
        filename, content = await hass.async_add_executor_job(
            read_uploaded_sound, hass, source
        )
        destination = destination_for_filename(filename)
        await hass.async_add_executor_job(
            selected_client.upload_sound, destination, content
        )
        async_dispatcher_send(hass, sound_list_signal(selected_entry_id))

    async def delete_sound(call: ServiceCall) -> None:
        selected_entry_id, selected_client = await _get_target(call)
        await hass.async_add_executor_job(
            selected_client.delete_sound, call.data["path"]
        )
        async_dispatcher_send(hass, sound_list_signal(selected_entry_id))

    async def refresh_sounds(call: ServiceCall) -> None:
        selected_entry_id, _ = await _get_target(call)
        async_dispatcher_send(hass, sound_list_signal(selected_entry_id))

    if not hass.services.has_service(DOMAIN, SERVICE_PLAY_URL):
        hass.services.async_register(DOMAIN, SERVICE_PLAY_URL, play_url)
        hass.services.async_register(DOMAIN, SERVICE_PLAY_SOUND, play_sound)
        hass.services.async_register(DOMAIN, SERVICE_RUN_COMMAND, run_command)
        hass.services.async_register(DOMAIN, SERVICE_UPLOAD_SOUND, upload_sound)
        hass.services.async_register(DOMAIN, SERVICE_DELETE_SOUND, delete_sound)
        hass.services.async_register(DOMAIN, SERVICE_REFRESH_SOUNDS, refresh_sounds)

    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    unloaded = (
        await hass.config_entries.async_unload_platforms(
            entry,
            PLATFORMS,
        )
    )
    if not unloaded:
        return False

    group_manager = hass.data[DOMAIN].get(DATA_MEDIA_GROUP)
    if group_manager is not None:
        await group_manager.unregister_member(entry.entry_id)
        if not group_manager.members:
            await group_manager.async_shutdown()
            hass.data[DOMAIN].pop(DATA_MEDIA_GROUP, None)

    hass.data[DOMAIN][DATA_COORDINATORS].pop(entry.entry_id, None)
    hass.data[DOMAIN][DATA_RADIO_PLAYERS].pop(entry.entry_id, None)

    sound_player = hass.data[DOMAIN][DATA_SOUND_PLAYERS].pop(
        entry.entry_id,
        None,
    )
    if sound_player:
        await sound_player.async_stop()

    telnet_client = hass.data[DOMAIN][DATA_CLIENTS].pop(
        entry.entry_id,
        None,
    )
    if telnet_client:
        await hass.async_add_executor_job(telnet_client.close)
    hass.data[DOMAIN][DATA_PLAYBACK_VOLUME].pop(
        entry.entry_id,
        None,
    )
    return True
