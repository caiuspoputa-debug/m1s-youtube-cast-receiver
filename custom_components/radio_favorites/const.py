from __future__ import annotations

DOMAIN = "radio_favorites"

CONF_NAME = "name"
CONF_STATIONS = "stations"

DEFAULT_NAME = "Radio Favorites"
DEFAULT_STATIONS = {
    "Radio Café România": "https://live.radiocafe.ro:8443/live.aac",
}

DATA_MANAGERS = "managers"
SIGNAL_STATIONS_UPDATED = f"{DOMAIN}_stations_updated"
SIGNAL_TARGET_UPDATED = f"{DOMAIN}_target_updated"
