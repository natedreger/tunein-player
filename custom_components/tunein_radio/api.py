"""Async client for the public TuneIn (RadioTime OPML) API."""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
import json
import logging
import re
from typing import Any
from urllib.parse import parse_qsl, urlparse

import aiohttp

_LOGGER = logging.getLogger(__name__)

BASE_URL = "https://opml.radiotime.com"
TIMEOUT = aiohttp.ClientTimeout(total=15)
STATION_ID_RE = re.compile(r"^s\d+$")

# Fallback search: tunein.com's own search page lists some stations the OPML
# API leaves out (e.g. ones flagged is_available:false). Its results are JSON
# embedded in the page; this pulls out the Station entries. It depends on
# TuneIn's page format, so any failure just means no extra results.
WEB_SEARCH_URL = "https://tunein.com/search/"
WEB_SEARCH_TIMEOUT = aiohttp.ClientTimeout(total=6)
_JSON_STR = r'"((?:[^"\\]|\\.)*)"'
WEB_STATION_RE = re.compile(
    r'"guideId":"(s\d+)","playableGuideId":"[^"]*","parentGuideId":"[^"]*",'
    r'"containerGuideId":"[^"]*","parentTitle":"[^"]*","seoInfo":\{[^}]*\},'
    r'"type":"Station","containerType":"[^"]*",'
    rf'"image":{_JSON_STR},"a11yTitle":{_JSON_STR},"title":{_JSON_STR}'
    rf'(?:,"subtitle":{_JSON_STR})?'
)


def _unescape(value: str | None) -> str:
    """Decode a JSON string body captured by WEB_STATION_RE."""
    if value is None:
        return ""
    try:
        return json.loads(f'"{value}"')
    except ValueError:
        return value


def rank_by_name(stations: list[Station], query: str) -> list[Station]:
    """Put exact name matches first, then prefix matches; otherwise keep order.

    So searching "KEXP" puts KEXP itself first, even when it only came from the
    fallback.
    """
    q = query.strip().casefold()

    def rank(station: Station) -> int:
        name = station.name.casefold()
        bare = re.sub(r"\s*\(.*\)$", "", name)  # "WBHM 90.3 (Birmingham, AL)"
        if q in (name, bare):
            return 0
        return 1 if name.startswith(q) else 2

    return sorted(stations, key=rank)  # sorted() is stable


def parse_web_search(html: str) -> list[Station]:
    """Extract stations from a tunein.com search page."""
    stations: list[Station] = []
    seen: set[str] = set()
    for match in WEB_STATION_RE.finditer(html):
        station_id, image, _a11y, title, subtitle = match.groups()
        if station_id in seen:
            continue
        seen.add(station_id)
        stations.append(
            Station(
                id=station_id,
                name=_unescape(title) or station_id,
                subtext=_unescape(subtitle),
                image=https(_unescape(image)),
            )
        )
    return stations

FORMAT_TO_MIME = {
    "mp3": "audio/mpeg",
    "aac": "audio/aac",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
}


class TuneInError(Exception):
    """Raised when the TuneIn API fails or returns something unusable."""


def https(url: str | None) -> str:
    """TuneIn returns http:// logo URLs; their CDN also serves https."""
    return (url or "").replace("http://", "https://", 1)


def mime_for_formats(formats: str | None) -> str:
    """Map TuneIn's `formats` field (e.g. "mp3" or "aac,mp3") to a MIME type."""
    first = (formats or "mp3").split(",")[0].strip().lower()
    return FORMAT_TO_MIME.get(first, "audio/mpeg")


@dataclass(slots=True)
class Station:
    """A playable TuneIn station."""

    id: str
    name: str
    subtext: str = ""
    image: str = ""
    formats: str = "mp3"

    @property
    def mime_type(self) -> str:
        """MIME type to advertise to media players."""
        return mime_for_formats(self.formats)

    def as_dict(self) -> dict[str, str]:
        """Serialize for storage / websocket."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Station:
        """Build from a stored or websocket dict."""
        return cls(
            id=str(data["id"]),
            name=str(data.get("name") or data["id"]),
            subtext=str(data.get("subtext") or ""),
            image=https(data.get("image")),
            formats=str(data.get("formats") or "mp3"),
        )

    @classmethod
    def from_outline(cls, item: dict[str, Any]) -> Station:
        """Build from a TuneIn outline (Search.ashx / Browse.ashx)."""
        return cls(
            id=item["guide_id"],
            name=item.get("text", item["guide_id"]),
            subtext=item.get("subtext", ""),
            image=https(item.get("image")),
            formats=item.get("formats", "mp3"),
        )


@dataclass(slots=True)
class Link:
    """A browsable TuneIn category (Browse.ashx)."""

    title: str
    query: str  # e.g. "c=music" or "id=g3124"


@dataclass(slots=True)
class Stream:
    """A direct stream URL returned by Tune.ashx."""

    url: str
    mime_type: str
    bitrate: int
    reliability: int


def is_station_outline(item: dict[str, Any]) -> bool:
    """True for live radio stations (not shows, podcasts or episodes)."""
    return (
        item.get("type") == "audio"
        and item.get("item") == "station"
        and bool(STATION_ID_RE.match(item.get("guide_id", "")))
    )


def browse_query(url: str | None) -> str | None:
    """Turn a Browse.ashx URL into a compact query string, or None."""
    if not url:
        return None
    parsed = urlparse(url)
    if not parsed.path.lower().endswith("/browse.ashx"):
        return None
    params = [(k, v) for k, v in parse_qsl(parsed.query) if k in ("c", "id", "filter")]
    return "&".join(f"{k}={v}" for k, v in params) or None


class TuneInClient:
    """Minimal async client for Search, Browse, Describe and Tune."""

    def __init__(self, session: aiohttp.ClientSession) -> None:
        """Initialize with a shared aiohttp session."""
        self._session = session

    async def _get(self, endpoint: str, params: dict[str, str]) -> list[dict[str, Any]]:
        return (await self._request(endpoint, params)).get("body", [])

    async def _request(self, endpoint: str, params: dict[str, str]) -> dict[str, Any]:
        try:
            async with self._session.get(
                f"{BASE_URL}/{endpoint}",
                params={**params, "render": "json"},
                timeout=TIMEOUT,
            ) as resp:
                resp.raise_for_status()
                # TuneIn sometimes labels JSON as text/html.
                data = await resp.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            raise TuneInError(f"TuneIn {endpoint} failed: {err}") from err
        head = data.get("head", {})
        if str(head.get("status", "200")) != "200":
            raise TuneInError(head.get("fault") or f"TuneIn {endpoint} error")
        return data

    async def search(self, query: str) -> list[Station]:
        """Search for live stations: the OPML API plus the tunein.com fallback.

        API results come first; the fallback only adds stations the API
        didn't return. Raises only if both sources fail.
        """
        api, web = await asyncio.gather(
            self.search_api(query), self.search_web(query), return_exceptions=True
        )
        if isinstance(api, BaseException) and isinstance(web, BaseException):
            raise api if isinstance(api, TuneInError) else TuneInError(str(api))
        if isinstance(api, BaseException):
            _LOGGER.debug("TuneIn API search failed, using web results only: %s", api)
            api = []
        if isinstance(web, BaseException):
            _LOGGER.debug("tunein.com fallback search failed: %s", web)
            web = []
        seen = {s.id for s in api}
        merged = [*api, *(s for s in web if s.id not in seen)]
        return rank_by_name(merged, query)

    async def search_api(self, query: str) -> list[Station]:
        """Search live stations with the OPML API (Search.ashx)."""
        body = await self._get("Search.ashx", {"query": query, "types": "station"})
        return [Station.from_outline(i) for i in body if is_station_outline(i)]

    async def search_web(self, query: str) -> list[Station]:
        """Search tunein.com's own search page (fallback)."""
        try:
            async with self._session.get(
                WEB_SEARCH_URL,
                params={"query": query},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=WEB_SEARCH_TIMEOUT,
            ) as resp:
                resp.raise_for_status()
                html = await resp.text()
        except (aiohttp.ClientError, TimeoutError) as err:
            raise TuneInError(f"tunein.com search failed: {err}") from err
        return parse_web_search(html)

    async def browse(
        self, query: str | None = None
    ) -> tuple[str, list[Link], list[Station]]:
        """Browse a category -> (title, sub-categories, stations).

        Grouped sections (e.g. "Featured", "Stations") are flattened.
        """
        params = dict(parse_qsl(query)) if query else {}
        data = await self._request("Browse.ashx", params)
        title = data.get("head", {}).get("title") or "TuneIn"
        body = data.get("body", [])
        links: list[Link] = []
        stations: list[Station] = []
        seen: set[str] = set()

        def walk(items: list[dict[str, Any]]) -> None:
            for item in items:
                if "children" in item:
                    walk(item["children"])
                elif is_station_outline(item):
                    if item["guide_id"] not in seen:
                        seen.add(item["guide_id"])
                        stations.append(Station.from_outline(item))
                elif item.get("type") == "link" and (q := browse_query(item.get("URL"))):
                    # Skip podcasts; this integration is for live radio.
                    if q != "c=podcast":
                        links.append(Link(item.get("text", q), q))

        walk(body)
        return title, links, stations

    async def describe(self, station_id: str) -> Station:
        """Look up a station's name and logo by ID."""
        body = await self._get("Describe.ashx", {"id": station_id})
        info = next((i for i in body if i.get("element") == "station"), None)
        if not info:
            raise TuneInError(f"Station {station_id} not found")
        name = info.get("name") or station_id
        if info.get("frequency") and info.get("band") in ("AM", "FM"):
            name = f"{name} {info['frequency']} {info['band']}"
        return Station(
            id=station_id,
            name=name,
            subtext=info.get("slogan") or info.get("location") or "",
            image=https(info.get("logo")),
        )

    async def tune(self, station_id: str) -> list[Stream]:
        """Resolve a station to direct stream URLs, most reliable first."""
        body = await self._get("Tune.ashx", {"id": station_id, "formats": "mp3,aac"})
        streams = [
            Stream(
                url=i["url"],
                mime_type=FORMAT_TO_MIME.get(str(i.get("media_type", "")).lower(), "audio/mpeg"),
                bitrate=int(i.get("bitrate") or 0),
                reliability=int(i.get("reliability") or 0),
            )
            for i in body
            if i.get("url")
        ]
        if not streams:
            raise TuneInError(f"No streams available for {station_id}")
        # Prefer reliability, then MP3 (the most widely supported codec).
        streams.sort(key=lambda s: (-s.reliability, s.mime_type != "audio/mpeg"))
        return streams
