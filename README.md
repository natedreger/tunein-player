# TuneIn Radio for Home Assistant + OwnTone

Search TuneIn, keep a favorites list, and play stations on your OwnTone
speakers from Home Assistant. Built on the public TuneIn (RadioTime OPML) API
([reference](https://apis.io/providers/tunein/)).

```
 ┌──────────────── Home Assistant ────────────────┐
 │  TuneIn Radio (this repo)     OwnTone           │
 │  · sidebar panel        ───►  (forked_daapd,    │
 │  · media source               built in)         │──► OwnTone server ──► AirPlay / Chromecast /
 │  · tunein_radio.* actions                       │    (owntone/)          local speakers
 └─────────────────────────────────────────────────┘
          │ search / stream URLs
          ▼
   opml.radiotime.com (TuneIn)
```

- **TuneIn Radio** (`custom_components/tunein_radio`) handles finding stations: search, favorites, categories, and resolving a station to its stream URL.
- **OwnTone** handles the audio. Home Assistant's built-in [OwnTone integration](https://www.home-assistant.io/integrations/forked_daapd) (`forked_daapd`) controls it. TuneIn Radio hands it the stream URL, and OwnTone plays it on whichever outputs are enabled.

OwnTone is a separate C server, so it can't run inside an integration. Run it
next to Home Assistant; `owntone/docker-compose.yml` is provided.

## What you get

| | |
|---|---|
| **Sidebar panel** ("TuneIn") | Search box, ★ Favorites, speaker picker (OwnTone first), play/pause/stop/volume. "This browser" plays on the device you're using. |
| **Media browser** | *Media → TuneIn Radio* in HA, and inside the OwnTone player's own browser: Favorites, Local Radio, Music, Talk, Sports, By Location, By Language. Search where your HA version supports it. |
| **Actions** | `tunein_radio.play` (station ID or search text) · `tunein_radio.add_favorite` · `tunein_radio.remove_favorite` |
| **Favorites** | Stored in HA, so they're shared by every user and device. Preloaded with **WBHM 90.3** (`s27454`) and **KCRW 89.9** (`s32152`). |

## Setup

1. **Run OwnTone**: `cd owntone && docker compose up -d`, then open `http://<host>:3689` and enable your speakers.
2. **Add OwnTone to HA**: *Settings → Devices & services → Add integration → OwnTone*, using host `<host>` and port `3689`.
3. **Install TuneIn Radio**: in HACS, add this repo as a custom repository (category *Integration*), or copy `custom_components/tunein_radio` into your HA `config/custom_components/`. Then restart HA.
4. **Add TuneIn Radio**: *Add integration → TuneIn Radio*. The **TuneIn** panel appears in the sidebar.

Tested against Home Assistant 2026.2.

## Automation examples

```yaml
# Morning news on the OwnTone speakers
action: tunein_radio.play
target:
  entity_id: media_player.owntone_server
data:
  station_id: s27454   # WBHM

# ...or by name
action: tunein_radio.play
target:
  entity_id: media_player.owntone_server
data:
  query: KCRW
```

Station IDs are the `s…` IDs TuneIn uses. Find one with the panel's search, or with
`https://opml.radiotime.com/Search.ashx?query=<name>&render=json`.

## Streams for the default favorites

| Station | TuneIn ID | Streams (from `Tune.ashx`) |
|---|---|---|
| WBHM 90.3 Birmingham | `s27454` | `https://streams.radiomast.io/268b6214-4f60-4898-85f6-51132c9fa4e0` (MP3 320k), `https://audio.wbhm.org/live.m4a` (AAC) |
| KCRW 89.9 Santa Monica | `s32152` | `https://streams.kcrw.com/kcrw_mp3` (MP3 192k), `https://streams.kcrw.com/kcrw_aac` (AAC 256k) |

These URLs aren't hard-coded. They're looked up through TuneIn each time a station plays, so they stay current.

## Standalone web player

The original browser-only player is still here, for use without Home Assistant:

```sh
npm start   # Node 18+, no dependencies → http://localhost:3000
```

`server.js` serves `public/` and proxies TuneIn, which doesn't allow direct browser (CORS) requests.

## Layout

```
custom_components/tunein_radio/
  __init__.py       setup, actions, panel registration
  api.py            async TuneIn client (Search / Browse / Describe / Tune)
  media_source.py   TuneIn in HA's media browser (and OwnTone's)
  websocket.py      commands used by the panel
  favorites.py      favorites stored in HA's .storage
  frontend/tunein-panel.js   sidebar panel (plain web component)
owntone/docker-compose.yml   OwnTone server
server.js, public/           standalone player
```
