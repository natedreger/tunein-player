// Default favorites, looked up via the TuneIn API (Search.ashx / Tune.ashx).
// `streams` are the direct URLs Tune.ashx returned; used as a fallback if
// the live lookup fails.
const DEFAULT_FAVORITES = [
  {
    id: "s27454",
    name: "WBHM 90.3 (Birmingham, AL)",
    subtext: "NPR News",
    image: "https://cdn-radiotime-logos.tunein.com/s27454q.png",
    streams: [
      "https://streams.radiomast.io/268b6214-4f60-4898-85f6-51132c9fa4e0",
      "https://audio.wbhm.org/live.m4a",
    ],
  },
  {
    id: "s32152",
    name: "KCRW 89.9 (Santa Monica, CA)",
    subtext: "NPR News & Music",
    image: "https://cdn-profiles.tunein.com/s32152/images/logoq.png?t=5",
    streams: [
      "https://streams.kcrw.com/kcrw_mp3?aw_0_1st.playerid=TuneIn",
      "https://streams.kcrw.com/kcrw_aac?aw_0_1st.playerid=TuneIn",
    ],
  },
];

const FAV_KEY = "tunein-favorites";
const $ = (id) => document.getElementById(id);
const audio = $("audio");
let current = null;

// ---------- Favorites (persisted in localStorage) ----------
function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAV_KEY));
    if (Array.isArray(saved)) return saved;
  } catch {}
  return DEFAULT_FAVORITES.slice();
}
let favorites = loadFavorites();
function saveFavorites() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); } catch {}
}
const isFav = (id) => favorites.some((f) => f.id === id);
function toggleFav(station) {
  favorites = isFav(station.id)
    ? favorites.filter((f) => f.id !== station.id)
    : [...favorites, station];
  saveFavorites();
  renderFavorites();
  document.querySelectorAll(`.fav[data-id="${station.id}"]`).forEach(updateFavBtn);
}
function updateFavBtn(btn) {
  const on = isFav(btn.dataset.id);
  btn.classList.toggle("on", on);
  btn.textContent = on ? "★" : "☆";
  btn.title = on ? "Remove from favorites" : "Add to favorites";
}

// ---------- Rendering ----------
function stationItem(station) {
  const li = document.createElement("li");
  li.className = "station";
  li.innerHTML = `
    <img alt="" loading="lazy" />
    <div class="info"><div class="name"></div><div class="sub"></div></div>
    <div class="actions">
      <button class="play" title="Play">▶</button>
      <button class="fav"></button>
    </div>`;
  const img = li.querySelector("img");
  img.onerror = () => (img.style.visibility = "hidden");
  if (station.image) img.src = station.image;
  li.querySelector(".name").textContent = station.name;
  li.querySelector(".sub").textContent = station.subtext || "";
  li.querySelector(".play").onclick = () => play(station);
  const fav = li.querySelector(".fav");
  fav.dataset.id = station.id;
  fav.onclick = () => toggleFav(station);
  updateFavBtn(fav);
  return li;
}
function renderFavorites() {
  const list = $("favList");
  list.replaceChildren(...favorites.map(stationItem));
  if (!favorites.length) list.innerHTML = "<li>No favorites yet.</li>";
}

// ---------- Search ----------
$("searchForm").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  $("status").textContent = "Searching…";
  $("results").replaceChildren();
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const stations = await r.json();
    if (!r.ok) throw new Error(stations.error);
    $("status").textContent = stations.length ? `${stations.length} stations` : "No stations found.";
    $("results").replaceChildren(...stations.map(stationItem));
  } catch (err) {
    $("status").textContent = `Search failed: ${err.message}`;
  }
};

// ---------- Playback ----------
async function getStreams(station) {
  try {
    const r = await fetch(`/api/tune?id=${encodeURIComponent(station.id)}`);
    const streams = await r.json();
    if (r.ok && streams.length) return streams.map((s) => s.url);
  } catch {}
  return station.streams || [];
}
async function play(station) {
  current = station;
  $("npName").textContent = station.name;
  $("npSub").textContent = "Connecting…";
  $("npLogo").src = station.image || "";
  $("playPause").disabled = false;
  const urls = await getStreams(station);
  for (const url of urls) {
    if (current !== station) return; // user picked another station
    audio.src = url;
    try {
      await audio.play();
      $("npSub").textContent = station.subtext || "Live";
      return;
    } catch (err) {
      if (err.name === "NotAllowedError") break;
    }
  }
  $("npSub").textContent = urls.length ? "Couldn't start stream" : "No stream available";
}
$("playPause").onclick = () => {
  if (!audio.src) return current && play(current);
  audio.paused ? audio.play() : audio.pause();
};
audio.onplay = () => { $("playPause").textContent = "⏸"; $("playPause").ariaLabel = "Pause"; };
audio.onpause = () => { $("playPause").textContent = "▶"; $("playPause").ariaLabel = "Play"; };
$("volume").oninput = (e) => (audio.volume = e.target.value);
audio.volume = $("volume").value;

// ---------- Favorites menu toggle ----------
$("favToggle").onclick = () => {
  const menu = $("favMenu");
  menu.hidden = !menu.hidden;
  $("favToggle").setAttribute("aria-expanded", String(!menu.hidden));
};
document.addEventListener("click", (e) => {
  if (!e.target.closest("#favMenu, #favToggle")) {
    $("favMenu").hidden = true;
    $("favToggle").setAttribute("aria-expanded", "false");
  }
});

renderFavorites();
