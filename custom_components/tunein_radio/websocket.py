"""Websocket commands used by the TuneIn panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.media_player import (
    DOMAIN as MEDIA_PLAYER_DOMAIN,
    MediaPlayerEntityFeature,
)
from homeassistant.const import ATTR_SUPPORTED_FEATURES
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from .api import Station, TuneInError
from .const import DOMAIN, OWNTONE_PLATFORM


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register the panel's websocket commands."""
    websocket_api.async_register_command(hass, ws_search)
    websocket_api.async_register_command(hass, ws_tune)
    websocket_api.async_register_command(hass, ws_favorites)
    websocket_api.async_register_command(hass, ws_add_favorite)
    websocket_api.async_register_command(hass, ws_remove_favorite)
    websocket_api.async_register_command(hass, ws_players)


def _data(hass: HomeAssistant):
    # Imported here to avoid a circular import with __init__.
    from . import get_data

    return get_data(hass)


def _stations(stations: list[Station]) -> list[dict[str, str]]:
    return [s.as_dict() for s in stations]


async def _run(connection, msg, coro) -> None:
    try:
        result = await coro
    except (TuneInError, HomeAssistantError) as err:
        connection.send_error(msg["id"], "tunein_error", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/search", vol.Required("query"): str}
)
@websocket_api.async_response
async def ws_search(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Search TuneIn for stations."""

    async def go():
        return _stations(await _data(hass).client.search(msg["query"]))

    await _run(connection, msg, go())


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/tune", vol.Required("station_id"): str}
)
@websocket_api.async_response
async def ws_tune(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Resolve stream URLs (used by the panel's 'This browser' player)."""

    async def go():
        streams = await _data(hass).client.tune(msg["station_id"])
        return [{"url": s.url, "mime_type": s.mime_type} for s in streams]

    await _run(connection, msg, go())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/favorites"})
@websocket_api.async_response
async def ws_favorites(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """List favorites."""

    async def go():
        return _stations(_data(hass).favorites.stations)

    await _run(connection, msg, go())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/favorites/add",
        vol.Required("station"): {
            vol.Required("id"): vol.Match(r"^s\d+$"),
            vol.Optional("name"): str,
            vol.Optional("subtext"): str,
            vol.Optional("image"): str,
            vol.Optional("formats"): str,
        },
    }
)
@websocket_api.async_response
async def ws_add_favorite(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Add a favorite."""

    async def go():
        favorites = _data(hass).favorites
        await favorites.async_add(Station.from_dict(msg["station"]))
        return _stations(favorites.stations)

    await _run(connection, msg, go())


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/favorites/remove", vol.Required("station_id"): str}
)
@websocket_api.async_response
async def ws_remove_favorite(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    """Remove a favorite."""

    async def go():
        favorites = _data(hass).favorites
        await favorites.async_remove(msg["station_id"])
        return _stations(favorites.stations)

    await _run(connection, msg, go())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/players"})
@callback
def ws_players(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """List media players that can play a URL, OwnTone ones first.

    OwnTone's per-output "zone" entities can't play media, so they drop out
    here; the OwnTone server entity plays to whichever outputs are enabled.
    """
    registry = er.async_get(hass)
    players = []
    for state in hass.states.async_all(MEDIA_PLAYER_DOMAIN):
        features = state.attributes.get(ATTR_SUPPORTED_FEATURES, 0)
        if not features & MediaPlayerEntityFeature.PLAY_MEDIA:
            continue
        entry = registry.async_get(state.entity_id)
        platform = entry.platform if entry else None
        players.append(
            {
                "entity_id": state.entity_id,
                "name": state.attributes.get("friendly_name", state.entity_id),
                "owntone": platform == OWNTONE_PLATFORM,
            }
        )
    players.sort(key=lambda p: (not p["owntone"], p["name"].lower()))
    connection.send_result(msg["id"], players)
