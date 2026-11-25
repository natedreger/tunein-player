// TuneIn Radio sidebar panel for Home Assistant.
// Plain web component (no build step). HA sets `hass`, `narrow` and `panel`.

const DOMAIN = "tunein_radio";
const BROWSER = "__browser__";
const PLAYER_KEY = "tunein_radio.player";

// HA may recreate the panel element (e.g. right after it first loads), so
// anything that must outlive one element lives at module level: the browser
// <audio> player and which station we started on each speaker.
const NOW_KEY = "tunein_radio.now_playing";
const shared = {
  audio: new Audio(),
  panels: new Set(),
  nowPlaying: (() => {
    try { return JSON.parse(sessionStorage.getItem(NOW_KEY)) || {}; } catch { return {}; }
  })(),
};
shared.audio.preload = "none";
shared.audio.onplay = shared.audio.onpause = () => shared.panels.forEach((p) => p._renderBar());

// `before` is the speaker's media_content_id when we started the station; the
// first different ID we see afterwards is our stream.
function setNowPlaying(player, station, before = null) {
  if (station) shared.nowPlaying[player] = { station, before, contentId: null };
  else delete shared.nowPlaying[player];
  try { sessionStorage.setItem(NOW_KEY, JSON.stringify(shared.nowPlaying)); } catch {}
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

class TuneInRadioPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._favorites = [];
    this._results = null;
    this._view = "favorites";
    this._players = [];
    this._player = this._loadPlayer();
    this._audio = shared.audio;
  }

  connectedCallback() {
    shared.panels.add(this);
  }

  // "This browser" playback keeps going while you use the rest of HA.
  disconnectedCallback() {
    shared.panels.delete(this);
  }

  // Station we started on the selected speaker, if it's still what's playing.
  _mine() {
    const entry = shared.nowPlaying[this._player];
    if (!entry) return null;
    if (this._player === BROWSER) return entry.station;
    const state = this._hass.states[this._player];
    if (!state || ["off", "idle", "unavailable", "unknown"].includes(state.state)) return null;
    const contentId = state.attributes.media_content_id ?? null;
    if (entry.contentId === null) {
      if (contentId !== entry.before) entry.contentId = contentId; // our stream started
    } else if (entry.contentId !== contentId) {
      setNowPlaying(this._player, null); // something else is playing now
      return null;
    }
    return entry.station;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
    else this._renderBar();
    if (this._menu) this._menu.hass = hass;
  }

  set narrow(narrow) {
    this._narrow = narrow;
    if (this._menu) this._menu.narrow = narrow;
  }

  // ---------- data ----------
  _ws(type, extra = {}) {
    return this._hass.callWS({ type: `${DOMAIN}/${type}`, ...extra });
  }

  async _init() {
    this._renderShell();
    try {
      const [favorites, players] = await Promise.all([this._ws("favorites"), this._ws("players")]);
      this._favorites = favorites;
      this._players = players;
      if (this._player !== BROWSER && !players.some((p) => p.entity_id === this._player)) {
        this._player = players.find((p) => p.owntone)?.entity_id || players[0]?.entity_id || BROWSER;
      }
    } catch (err) {
      this._status(`Couldn't load TuneIn: ${err.message || err}`);
    }
    this._renderPlayers();
    this._renderList();
    this._renderBar();
  }

  _loadPlayer() {
    try { return localStorage.getItem(PLAYER_KEY); } catch { return null; }
  }

  _savePlayer() {
    try { localStorage.setItem(PLAYER_KEY, this._player); } catch {}
  }

  _isFav(id) {
    return this._favorites.some((f) => f.id === id);
  }

  async _toggleFav(station) {
    try {
      this._favorites = this._isFav(station.id)
        ? await this._ws("favorites/remove", { station_id: station.id })
        : await this._ws("favorites/add", { station });
    } catch (err) {
      this._status(`Couldn't update favorites: ${err.message || err}`);
    }
    this._renderList();
  }

  async _search(query) {
    this._view = "results";
    this._results = null;
    this._status("Searching…");
    this._renderTabs();
    this.$("#list").replaceChildren();
    try {
      this._results = await this._ws("search", { query });
      this._status(this._results.length ? `${this._results.length} stations` : "No stations found.");
    } catch (err) {
      this._results = [];
      this._status(`Search failed: ${err.message || err}`);
    }
    this._renderList();
  }

  async _play(station) {
    this._status("");
    if (this._player === BROWSER) {
      setNowPlaying(BROWSER, station);
      this._renderBar("Connecting…");
      try {
        const streams = await this._ws("tune", { station_id: station.id });
        for (const s of streams) {
          if (shared.nowPlaying[BROWSER]?.station !== station) return;
          this._audio.src = s.url;
          try { await this._audio.play(); return this._renderBar(); }
          catch (e) { if (e.name === "NotAllowedError") break; }
        }
        this._renderBar("Couldn't start stream");
      } catch (err) {
        this._renderBar(`Couldn't start stream: ${err.message || err}`);
      }
      return;
    }
    this._audio.pause();
    const player = this._player;
    const before = this._hass.states[player]?.attributes.media_content_id ?? null;
    setNowPlaying(player, station, before);
    this._renderBar("Starting…");
    try {
      await this._hass.callService(DOMAIN, "play", { station_id: station.id }, { entity_id: player });
      this._renderBar();
    } catch (err) {
      setNowPlaying(player, null);
      this._renderBar(`Couldn't play: ${err.message || err}`);
    }
  }

  _control(action) {
    if (this._player === BROWSER) {
      if (action === "play_pause") this._audio.paused ? this._audio.play() : this._audio.pause();
      if (action === "stop") { this._audio.pause(); this._audio.removeAttribute("src"); setNowPlaying(BROWSER, null); this._renderBar(); }
      return;
    }
    this._hass.callService("media_player", action === "stop" ? "media_stop" : "media_play_pause", {
      entity_id: this._player,
    });
  }

  _setVolume(v) {
    if (this._player === BROWSER) this._audio.volume = v;
    else this._hass.callService("media_player", "volume_set", { entity_id: this._player, volume_level: v });
  }

  // ---------- rendering ----------
  $(sel) {
    return this.shadowRoot.querySelector(sel);
  }

  _status(text) {
    const el = this.$("#status");
    if (el) el.textContent = text;
  }

  _renderShell() {
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="toolbar">
        <span id="menu"></span>
        <div class="title">TuneIn</div>
        <label class="picker">
          <ha-icon icon="mdi:speaker"></ha-icon>
          <select id="player" aria-label="Play on"></select>
        </label>
      </div>
      <div class="scroll"><div class="content">
        <form id="search" role="search">
          <input id="q" type="search" placeholder="Search TuneIn stations" autocomplete="off" />
          <button type="submit">Search</button>
        </form>
        <div class="tabs">
          <button data-view="favorites">★ Favorites</button>
          <button data-view="results">Search results</button>
        </div>
        <p id="status"></p>
        <ul id="list"></ul>
      </div></div>
      <div class="bar">
        <img id="np-img" alt="" />
        <div class="np"><div id="np-name"></div><div id="np-sub"></div></div>
        <button class="round" id="pp" aria-label="Play/pause"><ha-icon icon="mdi:play"></ha-icon></button>
        <button class="round flat" id="stop" aria-label="Stop"><ha-icon icon="mdi:stop"></ha-icon></button>
        <input id="vol" type="range" min="0" max="1" step="0.02" aria-label="Volume" />
      </div>`;

    // HA's own menu button, so the sidebar can be opened on phones.
    this._menu = document.createElement("ha-menu-button");
    this._menu.hass = this._hass;
    this._menu.narrow = this._narrow;
    this.$("#menu").appendChild(this._menu);

    this.$("#search").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = this.$("#q").value.trim();
      if (q) this._search(q);
    });
    this.shadowRoot.querySelectorAll(".tabs button").forEach((b) =>
      b.addEventListener("click", () => { this._view = b.dataset.view; this._status(""); this._renderList(); })
    );
    this.$("#player").addEventListener("change", (e) => {
      this._player = e.target.value;
      this._savePlayer();
      if (this._player !== BROWSER) this._audio.pause();
      this._renderBar();
    });
    this.$("#pp").addEventListener("click", () => this._control("play_pause"));
    this.$("#stop").addEventListener("click", () => this._control("stop"));
    this.$("#vol").addEventListener("change", (e) => this._setVolume(Number(e.target.value)));
    this.$("#np-img").addEventListener("error", (e) => (e.target.style.visibility = "hidden"));
  }

  _renderPlayers() {
    const opts = this._players.map(
      (p) => `<option value="${esc(p.entity_id)}">${p.owntone ? "OwnTone · " : ""}${esc(p.name)}</option>`
    );
    opts.push(`<option value="${BROWSER}">This browser</option>`);
    const sel = this.$("#player");
    sel.innerHTML = opts.join("");
    sel.value = this._player;
  }

  _renderTabs() {
    this.shadowRoot.querySelectorAll(".tabs button").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === this._view)
    );
  }

  _renderList() {
    this._renderTabs();
    const list = this.$("#list");
    const stations = this._view === "favorites" ? this._favorites : this._results || [];
    if (this._view === "favorites" && !stations.length) this._status("No favorites yet. Search and tap ☆ to add one.");
    if (this._view === "results" && this._results === null && !this.$("#status").textContent)
      this._status("Search above to find stations.");
    list.replaceChildren(
      ...stations.map((s) => {
        const li = document.createElement("li");
        const fav = this._isFav(s.id);
        li.innerHTML = `
          <img alt="" loading="lazy" ${s.image ? `src="${esc(s.image)}"` : ""} />
          <div class="info"><div class="name">${esc(s.name)}</div><div class="sub">${esc(s.subtext)}</div></div>
          <button class="icon play" title="Play"><ha-icon icon="mdi:play"></ha-icon></button>
          <button class="icon fav ${fav ? "on" : ""}" title="${fav ? "Remove from" : "Add to"} favorites">
            <ha-icon icon="${fav ? "mdi:star" : "mdi:star-outline"}"></ha-icon></button>`;
        li.querySelector("img").addEventListener("error", (e) => (e.target.style.visibility = "hidden"));
        li.querySelector(".play").addEventListener("click", () => this._play(s));
        li.querySelector(".fav").addEventListener("click", () => this._toggleFav(s));
        return li;
      })
    );
  }

  _renderBar(message) {
    if (!this.$("#np-name")) return;
    let name, sub, img, playing, volume, active;
    const mine = this._mine();
    if (this._player === BROWSER) {
      const st = mine;
      active = !!st;
      name = st?.name || "Nothing playing";
      sub = st ? (this._audio.paused ? "Paused" : "Live · this browser") : "";
      img = st?.image;
      playing = !this._audio.paused;
      volume = this._audio.volume;
    } else {
      const state = this._hass.states[this._player];
      const a = state?.attributes || {};
      active = state && !["off", "idle", "unavailable", "unknown"].includes(state.state);
      name = active ? mine?.name || a.media_title || a.friendly_name : "Nothing playing";
      sub = active ? [a.media_artist, mine ? a.media_title : null, a.friendly_name].filter(Boolean).join(" · ") : a.friendly_name || "";
      img = active ? mine?.image || a.entity_picture : null;
      playing = state?.state === "playing";
      volume = a.volume_level ?? 0;
    }
    this.$("#np-name").textContent = name;
    this.$("#np-sub").textContent = message || sub;
    const imgEl = this.$("#np-img");
    if (img) { imgEl.src = img; imgEl.style.visibility = "visible"; }
    else { imgEl.removeAttribute("src"); imgEl.style.visibility = "hidden"; }
    this.$("#pp ha-icon").setAttribute("icon", playing ? "mdi:pause" : "mdi:play");
    this.$("#pp").disabled = !active;
    this.$("#stop").disabled = !active;
    const vol = this.$("#vol");
    if (this.shadowRoot.activeElement !== vol) vol.value = volume;
  }
}

const STYLE = `
  :host {
    display: flex; flex-direction: column; height: 100%; background: var(--primary-background-color);
    color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
    --accent: var(--primary-color, #03a9f4);
  }
  * { box-sizing: border-box; }
  .toolbar {
    display: flex; align-items: center; gap: 8px; height: var(--header-height, 56px); padding: 0 12px;
    background: var(--app-header-background-color, var(--primary-color));
    color: var(--app-header-text-color, #fff); flex: none;
  }
  .title { flex: 1; font-size: 20px; }
  .picker { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .picker select {
    max-width: 46vw; font: inherit; font-size: 14px; padding: 6px 8px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,.4); background: rgba(0,0,0,.15); color: inherit;
  }
  .picker option { color: var(--primary-text-color); background: var(--card-background-color); }
  .scroll { flex: 1; overflow-y: auto; }
  .content { max-width: 760px; margin: 0 auto; padding: 16px; }
  form { display: flex; gap: 8px; }
  input[type=search] {
    flex: 1; min-width: 0; font: inherit; padding: 10px 12px; border-radius: 8px;
    border: 1px solid var(--divider-color); background: var(--card-background-color); color: inherit;
  }
  button {
    font: inherit; cursor: pointer; border-radius: 8px; padding: 8px 14px; color: inherit;
    border: 1px solid var(--divider-color); background: var(--card-background-color);
  }
  button:disabled { opacity: .4; cursor: default; }
  .tabs { display: flex; gap: 8px; margin-top: 16px; }
  .tabs button.active { border-color: var(--accent); color: var(--accent); }
  #status { color: var(--secondary-text-color); min-height: 1.2em; margin: 12px 0 8px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    display: flex; align-items: center; gap: 12px; padding: 10px; margin-bottom: 8px;
    background: var(--card-background-color); border-radius: var(--ha-card-border-radius, 12px);
    box-shadow: var(--ha-card-box-shadow, none); border: 1px solid var(--divider-color);
  }
  li img, .bar img { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; flex: none; background: var(--divider-color); }
  .info { flex: 1; min-width: 0; }
  .name { font-weight: 500; }
  .sub, #np-sub { color: var(--secondary-text-color); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  button.icon { padding: 6px; display: grid; place-items: center; }
  button.fav.on { color: var(--state-icon-active-color, #fdd835); }
  .bar {
    flex: none; display: flex; align-items: center; gap: 12px;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: var(--card-background-color);
    border-top: 1px solid var(--divider-color);
  }
  .np { flex: 1; min-width: 0; }
  #np-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .round { width: 44px; height: 44px; border-radius: 50%; padding: 0; display: grid; place-items: center;
    background: var(--accent); color: var(--text-primary-color, #fff); border: none; flex: none; }
  .round.flat { background: none; color: inherit; border: 1px solid var(--divider-color); }
  #vol { width: 110px; accent-color: var(--accent); }
  @media (max-width: 520px) { #vol { display: none; } }
`;

customElements.define("tunein-radio-panel", TuneInRadioPanel);
