"""Persistent favorites list, stored in Home Assistant's .storage."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .api import Station
from .const import DEFAULT_FAVORITES, STORAGE_KEY, STORAGE_VERSION


class Favorites:
    """Ordered list of favorite stations."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the store."""
        self._store: Store[dict] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._stations: list[Station] = []

    async def async_load(self) -> None:
        """Load favorites, seeding the defaults on first run."""
        data = await self._store.async_load()
        if data is None:
            self._stations = [Station.from_dict(s) for s in DEFAULT_FAVORITES]
            await self._async_save()
        else:
            self._stations = [Station.from_dict(s) for s in data.get("stations", [])]

    async def _async_save(self) -> None:
        await self._store.async_save({"stations": [s.as_dict() for s in self._stations]})

    @property
    def stations(self) -> list[Station]:
        """Return a copy of the favorites."""
        return list(self._stations)

    def get(self, station_id: str) -> Station | None:
        """Return a favorite by ID."""
        return next((s for s in self._stations if s.id == station_id), None)

    async def async_add(self, station: Station) -> None:
        """Add (or update) a favorite."""
        for i, existing in enumerate(self._stations):
            if existing.id == station.id:
                self._stations[i] = station
                break
        else:
            self._stations.append(station)
        await self._async_save()

    async def async_remove(self, station_id: str) -> bool:
        """Remove a favorite. Returns False if it wasn't there."""
        before = len(self._stations)
        self._stations = [s for s in self._stations if s.id != station_id]
        if len(self._stations) == before:
            return False
        await self._async_save()
        return True
