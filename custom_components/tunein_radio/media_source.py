"""TuneIn as a Home Assistant media source.

Identifiers:
    ""                  root (Favorites + TuneIn's top-level categories)
    "favorites"         your saved stations
    "browse/<query>"    a TuneIn Browse.ashx category, e.g. browse/c=music
    "station/<id>"      a playable station, e.g. station/s27454

Station items use an audio MIME type as their content type, so the OwnTone
(`forked_daapd`) media browser, which filters on MIME type, lists them.
"""

from __future__ import annotations

from homeassistant.components.media_player import BrowseError, MediaClass, MediaType
from homeassistant.components.media_source import (
    BrowseMediaSource,
    MediaSource,
    MediaSourceItem,
    PlayMedia,
    Unresolvable,
)
from homeassistant.core import HomeAssistant

from . import get_data
from .api import Station, TuneInError
from .const import DOMAIN, NAME

# Not every HA release lets media sources take part in search.
SUPPORTS_SEARCH = hasattr(MediaSource, "async_search_media")


async def async_get_media_source(hass: HomeAssistant) -> TuneInMediaSource:
    """Set up the TuneIn media source."""
    return TuneInMediaSource(hass)


def _directory(identifier: str, title: str, thumbnail: str | None = None) -> BrowseMediaSource:
    return BrowseMediaSource(
        domain=DOMAIN,
        identifier=identifier,
        media_class=MediaClass.DIRECTORY,
        media_content_type=MediaType.MUSIC,
        title=title,
        can_play=False,
        can_expand=True,
        thumbnail=thumbnail,
    )


def _station(station: Station) -> BrowseMediaSource:
    return BrowseMediaSource(
        domain=DOMAIN,
        identifier=f"station/{station.id}",
        media_class=MediaClass.CHANNEL,
        media_content_type=station.mime_type,
        title=station.name,
        can_play=True,
        can_expand=False,
        thumbnail=station.image or None,
    )


class TuneInMediaSource(MediaSource):
    """Browse and resolve TuneIn stations."""

    name = NAME

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize."""
        super().__init__(DOMAIN)
        self.hass = hass

    async def async_resolve_media(self, item: MediaSourceItem) -> PlayMedia:
        """Resolve a station to its best direct stream."""
        kind, _, station_id = (item.identifier or "").partition("/")
        if kind != "station" or not station_id:
            raise Unresolvable(f"Not a TuneIn station: {item.identifier}")
        try:
            streams = await get_data(self.hass).client.tune(station_id)
        except TuneInError as err:
            raise Unresolvable(str(err)) from err
        return PlayMedia(streams[0].url, streams[0].mime_type)

    async def async_browse_media(self, item: MediaSourceItem) -> BrowseMediaSource:
        """Browse favorites and TuneIn categories."""
        data = get_data(self.hass)
        identifier = item.identifier or ""
        try:
            if identifier == "favorites":
                return self._folder(
                    identifier, "Favorites", [_station(s) for s in data.favorites.stations]
                )

            kind, _, query = identifier.partition("/")
            if identifier and kind != "browse":
                raise BrowseError(f"Unknown TuneIn item: {identifier}")

            title, links, stations = await data.client.browse(query or None)
            children = [_directory(f"browse/{link.query}", link.title) for link in links]
            children += [_station(s) for s in stations]
            if not identifier:
                children.insert(0, _directory("favorites", "Favorites"))
                return self._folder(None, NAME, children, root=True)
            return self._folder(identifier, title, children)
        except TuneInError as err:
            raise BrowseError(str(err)) from err

    @staticmethod
    def _folder(
        identifier: str | None,
        title: str,
        children: list[BrowseMediaSource],
        root: bool = False,
    ) -> BrowseMediaSource:
        return BrowseMediaSource(
            domain=DOMAIN,
            identifier=identifier,
            media_class=MediaClass.DIRECTORY,
            media_content_type=MediaType.MUSIC,
            title=title,
            can_play=False,
            can_expand=True,
            can_search=root and SUPPORTS_SEARCH,
            children=children,
            children_media_class=MediaClass.DIRECTORY,
        )

    if SUPPORTS_SEARCH:

        async def async_search_media(self, item, query):  # type: ignore[no-untyped-def]
            """Search TuneIn stations from the media browser."""
            from homeassistant.components.media_player import SearchMedia

            try:
                stations = await get_data(self.hass).client.search(query.search_query)
            except TuneInError as err:
                raise BrowseError(str(err)) from err
            return SearchMedia(result=[_station(s) for s in stations])
