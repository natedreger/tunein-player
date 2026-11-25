"""Constants for the TuneIn Radio integration."""

from typing import Final

DOMAIN: Final = "tunein_radio"
NAME: Final = "TuneIn Radio"

# Platform name of Home Assistant's OwnTone integration. Its media players are
# offered first in the panel's speaker picker.
OWNTONE_PLATFORM: Final = "forked_daapd"

PANEL_URL_PATH: Final = "tunein"
PANEL_WEBCOMPONENT: Final = "tunein-radio-panel"
PANEL_STATIC_URL: Final = f"/{DOMAIN}_static"
PANEL_TITLE: Final = "TuneIn"
PANEL_ICON: Final = "mdi:radio"

STORAGE_KEY: Final = f"{DOMAIN}.favorites"
STORAGE_VERSION: Final = 1

# Seeded into favorites the first time the integration is set up.
# IDs and logos come from TuneIn's Search.ashx / Describe.ashx.
DEFAULT_FAVORITES: Final = [
    {
        "id": "s27454",
        "name": "WBHM 90.3 (Birmingham, AL)",
        "subtext": "NPR News",
        "image": "https://cdn-radiotime-logos.tunein.com/s27454q.png",
        "formats": "mp3",
    },
    {
        "id": "s32152",
        "name": "KCRW 89.9 (Santa Monica, CA)",
        "subtext": "NPR News & Music",
        "image": "https://cdn-profiles.tunein.com/s32152/images/logoq.png",
        "formats": "mp3",
    },
]

ATTR_STATION_ID: Final = "station_id"
ATTR_QUERY: Final = "query"

SERVICE_PLAY: Final = "play"
SERVICE_ADD_FAVORITE: Final = "add_favorite"
SERVICE_REMOVE_FAVORITE: Final = "remove_favorite"
