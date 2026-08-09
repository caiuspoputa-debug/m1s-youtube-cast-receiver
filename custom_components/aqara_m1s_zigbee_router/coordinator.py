from __future__ import annotations

import asyncio
from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed


class AqaraM1SRouterCoordinator(DataUpdateCoordinator[dict]):
    """Shared availability and JN5189 lux data for the hub entities."""

    def __init__(self, hass: HomeAssistant, client) -> None:
        self.client = client
        self._was_online = False
        self._online_generation = 0
        super().__init__(
            hass,
            logger=__import__("logging").getLogger(__name__),
            name=f"Aqara M1S Router {client.host}",
            update_interval=timedelta(seconds=15),
        )

    async def _async_update_data(self) -> dict:
        online = await self.hass.async_add_executor_job(self.client.check_online)
        if not online:
            self._was_online = False
            raise UpdateFailed("Hub is offline")

        if not self._was_online:
            # The stock boot leaves the ring red. Give Wi-Fi, Telnet and the
            # JN5189 UART 10 seconds to settle before forcing the ring off.
            # This runs on the first successful connection and after every
            # real offline/online cycle.
            await asyncio.sleep(10)
            await self.hass.async_add_executor_job(
                self.client.set_rgb, 0, 0, 0
            )
            self._online_generation += 1
        self._was_online = True

        illuminance = None
        try:
            illuminance = await self.hass.async_add_executor_job(
                self.client.read_illuminance
            )
        except Exception:
            # A failed lux request must not make the otherwise healthy hub and
            # all of its entities unavailable.
            illuminance = None

        return {
            "online": True,
            "illuminance": illuminance,
            "online_generation": self._online_generation,
        }
