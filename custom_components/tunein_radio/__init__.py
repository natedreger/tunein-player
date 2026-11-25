"""TuneIn Radio for Home Assistant.

Provides:
- a media source (TuneIn favorites, categories and search) that any media
  player can browse, including OwnTone players from the `forked_daapd`
  integration;
- a sidebar panel with search, favorites and a speaker picker;
- `tunein_radio.play`, `add_favorite` and `remove_favorite` actions.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.media_player import (
    ATTR_MEDIA_CONTENT_ID,
    ATTR_MEDIA_CONTENT_TYPE,
    DOMAIN as MEDIA_PLAYER_DOMAIN,
    SERVICE_PLAY_MEDIA,
    MediaType,
)
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ConfigEntryNotReady, HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from . import websocket
from .api import Station, TuneInClient, TuneInError
from .const import (
    ATTR_QUERY,
    ATTR_STATION_ID,
    DOMAIN,
    PANEL_ICON,
    PANEL_STATIC_URL,
    PANEL_TITLE,
    PANEL_URL_PATH,
    PANEL_WEBCOMPONENT,
    SERVICE_ADD_FAVORITE,
    SERVICE_PLAY,
    SERVICE_REMOVE_FAVORITE,
)
from .favorites import Favorites

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


@dataclass
class TuneInData:
    """Runtime data for the config entry."""

    client: TuneInClient
    favorites: Favorites


type TuneInConfigEntry = ConfigEntry[TuneInData]


def media_source_id(station_id: str) -> str:
    """Media-source URI that resolves to a station's stream."""
    return f"media-source://{DOMAIN}/station/{station_id}"


def get_data(hass: HomeAssistant) -> TuneInData:
    """Return runtime data for the loaded entry, or raise."""
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state is ConfigEntryState.LOADED:
            return entry.runtime_data
    raise HomeAssistantError("TuneIn Radio is not set up")


PLAY_SCHEMA = vol.All(
    cv.make_entity_service_schema(
        {
            vol.Optional(ATTR_STATION_ID): cv.string,
            vol.Optional(ATTR_QUERY): cv.string,
        }
    ),
    cv.has_at_least_one_key(ATTR_STATION_ID, ATTR_QUERY),
)
STATION_SCHEMA = vol.Schema({vol.Required(ATTR_STATION_ID): cv.string})


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register actions and websocket commands (once, independent of entries)."""
    websocket.async_register(hass)

    async def play(call: ServiceCall) -> None:
        data = get_data(hass)
        station_id = call.data.get(ATTR_STATION_ID)
        try:
            if not station_id:
                results = await data.client.search(call.data[ATTR_QUERY])
                if not results:
                    raise HomeAssistantError(
                        f"No TuneIn station found for '{call.data[ATTR_QUERY]}'"
                    )
                station_id = results[0].id
        except TuneInError as err:
            raise HomeAssistantError(str(err)) from err
        await hass.services.async_call(
            MEDIA_PLAYER_DOMAIN,
            SERVICE_PLAY_MEDIA,
            {
                ATTR_ENTITY_ID: call.data[ATTR_ENTITY_ID],
                ATTR_MEDIA_CONTENT_ID: media_source_id(station_id),
                ATTR_MEDIA_CONTENT_TYPE: MediaType.MUSIC,
            },
            blocking=True,
            context=call.context,
        )

    async def add_favorite(call: ServiceCall) -> None:
        data = get_data(hass)
        try:
            station = await data.client.describe(call.data[ATTR_STATION_ID])
        except TuneInError as err:
            raise HomeAssistantError(str(err)) from err
        await data.favorites.async_add(station)

    async def remove_favorite(call: ServiceCall) -> None:
        await get_data(hass).favorites.async_remove(call.data[ATTR_STATION_ID])

    hass.services.async_register(DOMAIN, SERVICE_PLAY, play, PLAY_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_ADD_FAVORITE, add_favorite, STATION_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_REMOVE_FAVORITE, remove_favorite, STATION_SCHEMA
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: TuneInConfigEntry) -> bool:
    """Set up TuneIn Radio from a config entry."""
    client = TuneInClient(async_get_clientsession(hass))
    try:
        await client.browse()  # connectivity check
    except TuneInError as err:
        raise ConfigEntryNotReady(str(err)) from err

    favorites = Favorites(hass)
    await favorites.async_load()
    entry.runtime_data = TuneInData(client, favorites)

    await _async_register_panel(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: TuneInConfigEntry) -> bool:
    """Unload a config entry."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True


async def _async_register_panel(hass: HomeAssistant) -> None:
    """Serve the panel's JS and add it to the sidebar."""
    if not hass.data.get(f"{DOMAIN}_static"):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    PANEL_STATIC_URL, str(Path(__file__).parent / "frontend"), False
                )
            ]
        )
        hass.data[f"{DOMAIN}_static"] = True

    version = (await async_get_integration(hass, DOMAIN)).version
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_WEBCOMPONENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{PANEL_STATIC_URL}/tunein-panel.js?v={version}",
        require_admin=False,
    )


__all__ = ["Station", "TuneInConfigEntry", "get_data", "media_source_id"]
