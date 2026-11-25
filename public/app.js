// Default favorites. Only the station id is stored; stream URLs are looked up
// via the TuneIn API (Tune.ashx) every time a station is played.
const DEFAULT_FAVORITES = [
  {
    id: "s27454",
    name: "WBHM 90.3 (Birmingham, AL)",
    subtext: "NPR News",
    image: "https://cdn-radiotime-logos.tunein.com/s27454q.png",
  },
  {
    id: "s32152",
    name: "KCRW 89.9 (Santa Monica, CA)",
    subtext: "NPR News & Music",
    image: "https://cdn-profiles.tunein.com/s32152/images/logoq.png?t=5",
  },
  {
    id: "s24211",
    name: "88Nine Radio Milwaukee 88.9 (Milwaukee-Racine)",
    subtext: "Rock",
    image: "https://cdn-radiotime-logos.tunein.com/s24211q.png",
  },
];

const FAV_KEY = "tunein-favorites";
const $ = (id) => document.getElementById(id);
const audio = $("audio");
let current = null;

// ---------- Favorites (persisted in localStorage) ----------
const SEEN_KEY = "tunein-seen-defaults";
// Saved favorites win, but any default the user hasn't been offered yet is
// added once (so new defaults appear, and removed defaults stay removed).
function loadFavorites() {
  let saved = null, seen = [];
  try { saved = JSON.parse(localStorage.getItem(FAV_KEY)); } catch {}
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)) || []; } catch {}
  if (!Array.isArray(saved)) { saved = []; seen = []; }
  // Favorites saved before SEEN_KEY existed: treat the original defaults as seen.
  if (!seen.length && saved.length) seen = ["s27454", "s32152"];
  const fresh = DEFAULT_FAVORITES.filter((d) => !seen.includes(d.id) && !saved.some((f) => f.id === d.id));
  const result = [...saved, ...fresh];
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(result));
    localStorage.setItem(SEEN_KEY, JSON.stringify(DEFAULT_FAVORITES.map((d) => d.id)));
  } catch {}
  return result;
}
let favorites = loadFavorites();
function saveFavorites() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); } catch {}
}
// On load, look up each favorite by id (Describe.ashx) and update
// name/subtext/image if they changed. Failures leave it as is.
async function refreshFavorites() {
  let changed = false;
  await Promise.all(favorites.map(async (fav, i) => {
    try {
      const r = await fetch(`/api/station?id=${encodeURIComponent(fav.id)}`);
      if (!r.ok) return;
      const fresh = await r.json();
      const next = { ...fav, name: fresh.name || fav.name, subtext: fresh.subtext, image: fresh.image || fav.image };
      if (["name", "subtext", "image"].some((k) => next[k] !== fav[k])) {
        favorites[i] = next;
        changed = true;
      }
    } catch {}
  }));
  if (changed) { saveFavorites(); renderFavorites(); }
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
    if (r.ok) return streams.map((s) => s.url);
  } catch {}
  return [];
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
// Surface problems that happen after play() resolves (decode errors, stalls).
audio.onerror = () => {
  const e = audio.error;
  console.error("Audio error", e);
  $("npSub").textContent = `Playback error${e ? ` (code ${e.code})` : ""}`;
};
audio.onwaiting = () => { $("npSub").textContent = "Buffering…"; };
audio.onplaying = () => {
  console.log("Playing", audio.currentSrc, { muted: audio.muted, volume: audio.volume });
  $("npSub").textContent = current?.subtext || "Live";
};
const VOL_KEY = "tunein-volume";
try {
  const v = parseFloat(localStorage.getItem(VOL_KEY));
  if (v >= 0 && v <= 1) $("volume").value = v;
} catch {}
$("volume").oninput = (e) => {
  audio.muted = false;
  audio.volume = e.target.value;
  try { localStorage.setItem(VOL_KEY, e.target.value); } catch {}
};
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
refreshFavorites();
