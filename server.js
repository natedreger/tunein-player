// Minimal TuneIn player server: serves ./public and proxies the TuneIn
// (RadioTime OPML) API, which doesn't send CORS headers for browsers.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API = "https://opml.radiotime.com";
const PUBLIC = path.join(__dirname, "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function sendJSON(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function tunein(endpoint, params) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("render", "json");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TuneIn ${endpoint} returned ${r.status}`);
  return r.json();
}

// GET /api/search?q=... -> playable stations only
async function search(q) {
  const data = await tunein("Search.ashx", { query: q, types: "station" });
  return (data.body || [])
    .filter((i) => i.type === "audio" && i.item === "station")
    .map((i) => ({
      id: i.guide_id,
      name: i.text,
      subtext: i.subtext || "",
      image: (i.image || "").replace(/^http:/, "https:"),
      bitrate: i.bitrate,
      formats: i.formats,
    }));
}

// GET /api/tune?id=s12345 -> direct stream URLs, best first
async function tune(id) {
  const data = await tunein("Tune.ashx", { id, formats: "mp3,aac" });
  return (data.body || [])
    .filter((s) => s.url)
    .map((s) => ({ url: s.url, bitrate: s.bitrate, type: s.media_type, reliability: s.reliability }))
    .sort((a, b) => (b.reliability || 0) - (a.reliability || 0));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return sendJSON(res, 400, { error: "Missing q" });
      return sendJSON(res, 200, await search(q));
    }
    if (url.pathname === "/api/tune") {
      const id = url.searchParams.get("id") || "";
      if (!/^[a-z]\d+$/i.test(id)) return sendJSON(res, 400, { error: "Bad id" });
      return sendJSON(res, 200, await tune(id));
    }
  } catch (err) {
    return sendJSON(res, 502, { error: err.message });
  }

  // Static files
  const file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(PORT, () => console.log(`TuneIn player on http://localhost:${PORT}`));
