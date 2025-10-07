// client-only nostr (nip-35) + webtorrent ui. searches kind 2003 events.
// note: keep usage legal.

// ===== utils =====
const $ = (q) => document.querySelector(q);
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text!=null) x.textContent = text; return x; };
const fmtBytes = (n) => { if (!Number.isFinite(n)) return "0 B"; const u=["B","KB","MB","GB","TB","PB"]; const i=Math.max(0,Math.floor(Math.log(n)/Math.log(1024))); return `${(n/Math.pow(1024,i)).toFixed(i?1:0)} ${u[i]}`; };
const uniq = (arr) => [...new Set(arr.map(s => s.trim()).filter(Boolean))];

// ===== webtorrent =====
let client;
let currentTorrent;

const defaultAnnounce = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.webtorrent.dev",
  "wss://tracker.files.fm:7073/announce",
];

function initClient() {
  if (client) return client;
  if (!window.WebTorrent) { alert("webtorrent failed to load"); throw new Error("webtorrent not available"); }
  client = new WebTorrent();
  return client;
}

const magnetForm = $("#magnet-form");
const magnetInput = $("#magnet-input");
const trackersInput = $("#trackers-input");
const fileInput = $("#file-input");
const drop = $("#drop");

const statusCard = $("#status");
const peerCountEl = $("#peerCount");
const downloadedEl = $("#downloaded");
const downRateEl = $("#downRate");
const upRateEl = $("#upRate");
const progressEl = $("#progress");
const infohashEl = $("#infohash");

const filesCard = $("#files");
const fileListEl = $("#fileList");
const previewCard = $("#preview");
const viewerEl = $("#viewer");
const saveTip = $("#save-tip");

const LS_MAGNET = "vtl:lastMagnet";
const LS_RELAYS = "vtl:relays";
const LS_TAG = "vtl:lastTag";

["dragenter","dragover"].forEach(evt =>
  drop.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); drop.classList.add("drag"); })
);
["dragleave","drop"].forEach(evt =>
  drop.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove("drag"); })
);
drop.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f && f.name.endsWith(".torrent")) { fileInput.files = e.dataTransfer.files; handleTorrentFile(f); }
});
fileInput.addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) handleTorrentFile(f); });
magnetForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const magnet = (magnetInput.value || "").trim();
  if (!magnet) return;
  localStorage.setItem(LS_MAGNET, magnet);
  loadTorrent(magnet);
});
(function bootstrapManualInputs() {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("magnet");
  const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("magnet");
  const last = localStorage.getItem(LS_MAGNET);
  const val = fromQuery || fromHash || last || "";
  if (val) magnetInput.value = val;
  if (fromQuery || fromHash) loadTorrent(val);
})();

function handleTorrentFile(file) { loadTorrent(file); }

function parseExtraTrackers() {
  const txt = (trackersInput.value || "").trim();
  if (!txt) return [];
  return txt.split(",").map(s => s.trim()).filter(Boolean);
}

function resetWTUI() {
  statusCard.classList.remove("hidden");
  filesCard.classList.add("hidden");
  previewCard.classList.add("hidden");
  fileListEl.innerHTML = "";
  viewerEl.innerHTML = "";
  progressEl.value = 0;
  peerCountEl.textContent = "0";
  downloadedEl.textContent = "0 B";
  downRateEl.textContent = "0 B/s";
  upRateEl.textContent = "0 B/s";
  infohashEl.textContent = "";
}

function loadTorrent(input) {
  initClient();
  if (currentTorrent) { try { currentTorrent.destroy(); } catch {} currentTorrent = null; }
  resetWTUI();
  const opts = { announce: uniq([...defaultAnnounce, ...parseExtraTrackers()]) };
  client.add(input, opts, (torrent) => {
    currentTorrent = torrent;
    infohashEl.textContent = `infohash: ${torrent.infoHash}`;
    filesCard.classList.remove("hidden");
    renderFiles(torrent);
    const onStats = () => {
      peerCountEl.textContent = String(torrent.numPeers);
      downloadedEl.textContent = fmtBytes(torrent.downloaded);
      downRateEl.textContent = `${fmtBytes(torrent.downloadSpeed)}/s`;
      upRateEl.textContent = `${fmtBytes(torrent.uploadSpeed)}/s`;
      progressEl.value = torrent.progress;
    };
    torrent.on("download", onStats);
    torrent.on("upload", onStats);
    setInterval(onStats, 500);
    torrent.on("done", () => { onStats(); progressEl.classList.add("done"); setTimeout(() => progressEl.classList.remove("done"), 1000); });
    torrent.on("error", (err) => alert(`torrent error: ${err?.message || err}`));
    torrent.on("wire", onStats);
    onStats();

    const firstPlayable = torrent.files.find(f => /\.(mp4|webm|mp3|wav|ogg|m4a|png|jpg|jpeg|gif)$/i.test(f.name));
    if (firstPlayable) previewFile(firstPlayable);
  });
}

function renderFiles(torrent) {
  fileListEl.innerHTML = "";
  torrent.files.forEach((file) => {
    const li = el("li","file");
    const meta = el("div","meta");
    const name = el("div", null, file.name);
    const size = el("span","badge", fmtBytes(file.length));
    meta.appendChild(name); meta.appendChild(size);

    const actions = el("div","actions");
    const dlBtn = el("button", null, "download");
    dlBtn.addEventListener("click", async () => {
      dlBtn.disabled = true; dlBtn.textContent = "preparing…";
      try {
        const blob = await getFileBlob(file);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch (e) { alert(`download failed: ${e?.message || e}`); }
      dlBtn.disabled = false; dlBtn.textContent = "download";
    });
    const pvBtn = el("button", null, "preview"); pvBtn.addEventListener("click", () => previewFile(file));
    const link = el("a", null, "open"); link.href = "#";
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const blob = await getFileBlob(file);
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e2) { alert(`open failed: ${e2?.message || e2}`); }
    });

    actions.appendChild(dlBtn); actions.appendChild(pvBtn); actions.appendChild(link);
    li.appendChild(meta); li.appendChild(actions);
    fileListEl.appendChild(li);
  });
  filesCard.classList.remove("hidden");
  saveTip.style.display = "block";
}

function getFileBlob(file) { return new Promise((resolve, reject) => file.getBlob((err, blob) => err ? reject(err) : resolve(blob))); }

async function previewFile(file) {
  previewCard.classList.remove("hidden");
  viewerEl.innerHTML = "";
  const lower = file.name.toLowerCase();
  if (/\.(mp4|webm)$/.test(lower)) {
    const video = el("video"); video.controls = true; video.playsInline = true; viewerEl.appendChild(video);
    file.appendTo(video, (err) => { if (err) showBlobPreview(file, "video"); }); return;
  }
  if (/\.(mp3|m4a|wav|ogg)$/.test(lower)) {
    const audio = el("audio"); audio.controls = true; viewerEl.appendChild(audio);
    file.appendTo(audio, (err) => { if (err) showBlobPreview(file, "audio"); }); return;
  }
  if (/\.(png|jpg|jpeg|gif|webp|bmp)$/.test(lower)) return showBlobPreview(file, "img");
  const p = el("p","tiny","no inline preview available. use the download button instead."); viewerEl.appendChild(p);
}
async function showBlobPreview(file, kind) {
  try {
    const blob = await getFileBlob(file);
    const url = URL.createObjectURL(blob);
    if (kind === "video") { const v = el("video"); v.controls = true; v.playsInline = true; v.src = url; viewerEl.appendChild(v); }
    else if (kind === "audio") { const a = el("audio"); a.controls = true; a.src = url; viewerEl.appendChild(a); }
    else { const i = el("img"); i.alt = file.name; i.src = url; viewerEl.appendChild(i); }
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (e) { viewerEl.appendChild(el("p","tiny",`preview failed: ${e?.message || e}`)); }
}

window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="v") { if (document.activeElement !== magnetInput) magnetInput.focus(); } });
window.addEventListener("beforeunload", (e) => { if (currentTorrent && currentTorrent.downloaded < currentTorrent.length) { e.preventDefault(); e.returnValue = ""; } });

// ===== nostr (nip-35) =====
const relayList = $("#relayList");
const tagInput = $("#tagInput");
const limitInput = $("#limitInput");
const searchBtn = $("#searchBtn");
const nostrStatus = $("#nostrStatus");
const results = $("#results");

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://offchain.pub",
  "wss://nos.lol",
  "wss://eden.nostr.land",
  "wss://relay.nostr.band"
];

(function bootstrapRelays() {
  const saved = localStorage.getItem(LS_RELAYS);
  const relays = saved ? JSON.parse(saved) : DEFAULT_RELAYS;
  relayList.value = relays.join("\n");
  tagInput.value = localStorage.getItem(LS_TAG) || "";
})();

searchBtn.addEventListener("click", () => {
  const relays = relayList.value.split("\n").map(s => s.trim()).filter(Boolean);
  localStorage.setItem(LS_RELAYS, JSON.stringify(relays));
  const q = tagInput.value.trim();
  localStorage.setItem(LS_TAG, q);
  const limit = Math.max(1, Math.min(200, parseInt(limitInput.value || "100", 10)));
  searchNostr(relays, q, limit);
});

// active sockets
let activeSockets = [];
let subId = null;
let seenEventIds = new Set();
let shownCount = 0;

function closeActiveSockets() { activeSockets.forEach(ws => { try { ws.close(); } catch {} }); activeSockets = []; subId = null; }
function updateStatus(txt) { nostrStatus.textContent = `status: ${txt}`; }

// parse query: returns {tags:[], keywords:[]}
// rules: comma-separated values => tags; words with spaces => keywords.
// tokens starting with '#' are tags. a single, one-word token is tried as both (client-side).
function parseQuery(q) {
  if (!q) return { tags: [], keywords: [] };
  const hasComma = q.includes(",");
  if (hasComma) {
    const parts = q.split(",").map(s => s.trim()).filter(Boolean);
    const tags = parts.map(s => s.replace(/^#/, "")).filter(Boolean);
    return { tags, keywords: [] };
  }
  if (q.includes(" ")) return { tags: [], keywords: q.toLowerCase().split(/\s+/).filter(Boolean) };
  // single token: try as tag and as keyword
  return { tags: [q.replace(/^#/, "")], keywords: [q.toLowerCase()] };
}

function searchNostr(relayUrls, query, limit) {
  closeActiveSockets();
  results.innerHTML = "";
  seenEventIds.clear();
  shownCount = 0;
  if (relayUrls.length === 0) { updateStatus("no relays configured"); return; }

  const { tags, keywords } = parseQuery(query);
  const applyServerTagFilter = tags.length > 0 && keywords.length === 0;

  subId = `sub_${Math.random().toString(36).slice(2, 10)}`;
  const filter = { kinds: [2003], limit };
  if (applyServerTagFilter) filter["#t"] = tags.slice(0, 10); // nostr relays ignore extras anyway

  updateStatus(`connecting to ${relayUrls.length} relays…`);

  let eoseCount = 0, openCount = 0;

  relayUrls.forEach((url) => {
    try {
      const ws = new WebSocket(url);
      ws.onopen = () => { openCount++; updateStatus(`connected ${openCount}/${relayUrls.length}; querying…`); ws.send(JSON.stringify(["REQ", subId, filter])); };
      ws.onmessage = (ev) => handleRelayMessage(url, ev.data, { keywords, tags });
      ws.onerror = () => updateStatus(`error on ${url}`);
      ws.onclose = () => updateStatus(`closed ${url}`);
      activeSockets.push(ws);
    } catch {}
  });

  function handleRelayMessage(sourceRelay, raw, q) {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const [type, ...rest] = msg;
    if (type === "EVENT") {
      const [sid, ev] = rest;
      if (sid !== subId) return;
      if (seenEventIds.has(ev.id)) return;
      seenEventIds.add(ev.id);
      const parsed = parseTorrentEvent(ev);
      if (!parsed) return;
      if (matchQuery(parsed, ev, q)) {
        results.appendChild(renderResultItem(parsed, ev, sourceRelay));
        shownCount++;
        updateStatus(`results: ${shownCount} (live)…`);
      }
    } else if (type === "EOSE") {
      const [sid] = rest;
      if (sid !== subId) return;
      eoseCount++;
      updateStatus(`done (EOSE ${eoseCount}/${relayUrls.length}) · results: ${shownCount}${shownCount===0 ? " · no results" : ""}`);
      if (eoseCount >= relayUrls.length) setTimeout(closeActiveSockets, 500);
    }
  }
}

// check if an event matches keywords/tags (client-side)
function matchQuery(t, ev, { keywords, tags }) {
  // tags condition: if tags provided (and we didn’t rely solely on server filter), require at least one tag match
  if (tags && tags.length) {
    const tTags = (t.tTags || []).map(x => x.toLowerCase());
    const hasTag = tags.some(tag => tTags.includes(tag.toLowerCase()));
    if (!hasTag) return false;
  }
  if (!keywords || keywords.length === 0) return true;

  const hay = [
    t.title || "",
    ev.content || "",
    t.infoHash || "",
    ...(t.tTags || []),
    ...(t.iRefs || []),
    ...(t.files || []).map(f => f.name || "")
  ].join(" ").toLowerCase();

  return keywords.every(k => hay.includes(k));
}

// parse kind 2003 → magnet etc.
function parseTorrentEvent(ev) {
  if (!ev || ev.kind !== 2003 || !Array.isArray(ev.tags)) return null;
  const getFirstTag = (name) => { const t = ev.tags.find((x) => x[0] === name); return t ? t.slice(1) : null; };
  const getAllTags = (name) => ev.tags.filter((x) => x[0] === name).map(x => x.slice(1));

  const title = (getFirstTag("title") || [])[0] || (ev.content || "").slice(0, 120) || "(untitled)";
  const xt = (getFirstTag("x") || [])[0];
  if (!xt) return null;

  const trackers = getAllTags("tracker").map(a => a[0]).filter(Boolean);
  const webrtcTrackers = trackers.filter(tr => tr.startsWith("wss://"));

  const files = getAllTags("file").map(([name, size]) => ({ name, size: parseInt(size || "0", 10) || 0 }));
  const totalSize = files.reduce((s,f)=>s+f.size,0);

  const tTags = ev.tags.filter(t => t[0] === "t").map(t => t[1]).filter(Boolean);
  const iRefs = ev.tags.filter(t => t[0] === "i").map(t => t[1]).filter(Boolean);

  let magnet = `magnet:?xt=urn:btih:${xt}`;
  webrtcTrackers.forEach(tr => { magnet += `&tr=${encodeURIComponent(tr)}`; });

  return { title, infoHash: xt, magnet, trackers: webrtcTrackers, files, totalSize, tTags, iRefs, author: ev.pubkey, created_at: ev.created_at };
}

function renderResultItem(t, ev, sourceRelay) {
  const item = el("div","item");
  const head = el("div","item-head");
  const left = el("div");
  left.appendChild(el("div","item-title", t.title));
  const sub = el("div","item-sub", `size: ${t.totalSize ? fmtBytes(t.totalSize) : "unknown"} · infohash: ${t.infoHash.slice(0,8)}… · relay: ${sourceRelay}`);
  left.appendChild(sub);
  head.appendChild(left);

  const actions = el("div","item-actions");
  const copyMag = el("button", null, "copy magnet");
  copyMag.addEventListener("click", async () => { try { await navigator.clipboard.writeText(t.magnet); copyMag.textContent = "copied!"; setTimeout(()=>copyMag.textContent="copy magnet", 1200); } catch {} });
  const loadBtn = el("button", null, "load");
  loadBtn.addEventListener("click", () => {
    const merged = uniq([...(trackersInput.value ? trackersInput.value.split(",") : []), ...t.trackers]);
    trackersInput.value = merged.join(", ");
    magnetInput.value = t.magnet;
    localStorage.setItem(LS_MAGNET, t.magnet);
    loadTorrent(t.magnet);
    window.scrollTo({ top: statusCard.offsetTop - 10, behavior: "smooth" });
  });
  actions.appendChild(loadBtn); actions.appendChild(copyMag);
  head.appendChild(actions);
  item.appendChild(head);

  if (t.tTags.length || t.iRefs.length) {
    const tags = el("div","item-tags");
    t.tTags.forEach(x => tags.appendChild(el("span","tag", `t:${x}`)));
    t.iRefs.forEach(x => tags.appendChild(el("span","tag", `i:${x}`)));
    item.appendChild(tags);
  }
  if (t.files.length) item.appendChild(el("div","tiny", `${t.files.length} file(s): ` + t.files.slice(0,5).map(f => `${f.name} (${fmtBytes(f.size)})`).join(", ") + (t.files.length>5?"…":"")));

  return item;
}