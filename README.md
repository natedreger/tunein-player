# TuneIn Player

A basic streaming radio player built on the public TuneIn (RadioTime OPML) API
([reference](https://apis.io/providers/tunein/)).

- **Search** for stations (`Search.ashx`)
- **Favorites** menu (★ button, saved in your browser), preloaded with:
  - **WBHM 90.3** Birmingham, AL: TuneIn id `s27454`
  - **KCRW 89.9** Santa Monica, CA: TuneIn id `s32152`
- **Play/pause and volume**. Stream URLs are resolved through `Tune.ashx`, and if a stream fails the player tries the next one.

## Run

```sh
npm start        # Node 18+, no dependencies
# open http://localhost:3000
```

`server.js` serves `public/` and proxies `/api/search` and `/api/tune` to
`opml.radiotime.com`. The proxy is needed because the TuneIn API doesn't send
CORS headers.

## Streams found for the default favorites

| Station | Stream URLs (from `Tune.ashx`) |
|---|---|
| WBHM | `https://streams.radiomast.io/268b6214-4f60-4898-85f6-51132c9fa4e0` (MP3 320k), `https://audio.wbhm.org/live.m4a` (AAC) |
| KCRW | `https://streams.kcrw.com/kcrw_mp3` (MP3 192k), `https://streams.kcrw.com/kcrw_aac` (AAC 256k) |

These URLs are stored as fallbacks. Each time you play a station, the app asks TuneIn for its current URLs first.
