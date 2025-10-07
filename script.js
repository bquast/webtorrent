// note: keep usage legal. this is a generic webtorrent ui that runs in the browser via webrtc.
// note: comments start lowercase by user preference.

const $ = (q) => document.querySelector(q);
const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return "0 B";
  const u = ["B","KB","MB","GB","TB","PB"];
  const i = Math.max(0, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};

let client;
let currentTorrent;

// default public webrtc trackers; users can add more in the ui if needed
const defaultAnnounce = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.webtorrent.dev",
  "wss://tracker.files.fm:7073/announce",
];

function initClient() {
  if (client) return client;
  // instantiate when webtorrent library is ready on window.WebTorrent
  if (!window.WebTorrent) {
    alert("webtorrent failed to load");
    throw new Error("webtorrent not available");
  }
  client = new WebTorrent();
  return client;
}

// ui elements
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

// persist magnet in local storage
const LS_KEY = "vtl:lastMagnet";

// drag and drop helpers
["dragenter","dragover"].forEach(evt =>
  drop.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation();
    drop.classList.add("drag");
  })
);
["dragleave","drop"].forEach(evt =>
  drop.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation();
    drop.classList.remove("drag");
  })
);
drop.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f && f.name.endsWith(".torrent")) {
    fileInput.files = e.dataTransfer.files;
    handleTorrentFile(f);
  }
});

// handle file chooser
fileInput.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) handleTorrentFile(f);
});

// handle magnet submit
magnetForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const magnet = (magnetInput.value || "").trim();
  if (!magnet) return;
  localStorage.setItem(LS_KEY, magnet);
  loadTorrent(magnet);
});

// support magnet via url hash (?magnet= or #magnet=) and restore last
(function bootstrapInputs() {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("magnet");
  const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("magnet");
  const last = localStorage.getItem(LS_KEY);
  const val = fromQuery || fromHash || last || "";
  if (val) magnetInput.value = val;
  // optional: auto-load if provided via url
  if (fromQuery || fromHash) {
    loadTorrent(val);
  }
})();

function handleTorrentFile(file) {
  // read the file into an ArrayBuffer; webtorrent accepts File/Blob directly too
  loadTorrent(file);
}

function parseExtraTrackers() {
  const txt = (trackersInput.value || "").trim();
  if (!txt) return [];
  return txt.split(",").map(s => s.trim()).filter(Boolean);
}

function resetUI() {
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
  // destroy previous torrent to free memory
  if (currentTorrent) {
    try { currentTorrent.destroy(); } catch {}
    currentTorrent = null;
  }
  resetUI();

  const opts = {
    announce: [...new Set([...defaultAnnounce, ...parseExtraTrackers()])],
  };

  client.add(input, opts, (torrent) => {
    currentTorrent = torrent;
    infohashEl.textContent = `infohash: ${torrent.infoHash}`;
    filesCard.classList.remove("hidden");

    renderFiles(torrent);

    // live stats
    const onStats = () => {
      const peers = torrent.numPeers; // webrtc peers
      peerCountEl.textContent = String(peers);
      downloadedEl.textContent = fmtBytes(torrent.downloaded);
      downRateEl.textContent = `${fmtBytes(torrent.downloadSpeed)}/s`;
      upRateEl.textContent = `${fmtBytes(torrent.uploadSpeed)}/s`;
      progressEl.value = torrent.progress;
    };
    torrent.on("download", onStats);
    torrent.on("upload", onStats);
    const t = setInterval(onStats, 500);
    torrent.on("done", () => {
      onStats();
      // gentle flash to indicate done
      progressEl.classList.add("done");
      setTimeout(() => progressEl.classList.remove("done"), 1000);
    });
    torrent.on("error", (err) => {
      alert(`torrent error: ${err?.message || err}`);
    });
    torrent.on("wire", onStats);
    onStats();

    // auto-preview first reasonable media file
    const firstPlayable = torrent.files.find(f => {
      const n = f.name.toLowerCase();
      return n.endsWith(".mp4") || n.endsWith(".webm") || n.endsWith(".mp3") || n.endsWith(".wav") || n.endsWith(".ogg") || n.endsWith(".m4a") || n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".gif");
    });
    if (firstPlayable) previewFile(firstPlayable);
  });
}

function renderFiles(torrent) {
  fileListEl.innerHTML = "";
  torrent.files.forEach((file, idx) => {
    const li = document.createElement("li");
    li.className = "file";

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.className = "badge";
    size.textContent = fmtBytes(file.length);
    meta.appendChild(name);
    meta.appendChild(size);

    const actions = document.createElement("div");
    actions.className = "actions";

    // download button (blob url)
    const dlBtn = document.createElement("button");
    dlBtn.textContent = "download";
    dlBtn.addEventListener("click", async () => {
      dlBtn.disabled = true;
      dlBtn.textContent = "preparing…";
      try {
        const blob = await getFileBlob(file);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch (e) {
        alert(`download failed: ${e?.message || e}`);
      } finally {
        dlBtn.disabled = false;
        dlBtn.textContent = "download";
      }
    });

    // preview button
    const pvBtn = document.createElement("button");
    pvBtn.textContent = "preview";
    pvBtn.addEventListener("click", () => previewFile(file));

    // direct link (stream) — some browsers stream instead of downloading
    const link = document.createElement("a");
    link.textContent = "open";
    link.href = "#";
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const blob = await getFileBlob(file);
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e2) {
        alert(`open failed: ${e2?.message || e2}`);
      }
    });

    actions.appendChild(dlBtn);
    actions.appendChild(pvBtn);
    actions.appendChild(link);

    li.appendChild(meta);
    li.appendChild(actions);
    fileListEl.appendChild(li);
  });

  filesCard.classList.remove("hidden");
  saveTip.style.display = "block";
}

function getFileBlob(file) {
  // webtorrent file api supports arrayBuffer/stream/blob callback; wrap in promise
  return new Promise((resolve, reject) => {
    file.getBlob((err, blob) => {
      if (err) reject(err);
      else resolve(blob);
    });
  });
}

async function previewFile(file) {
  previewCard.classList.remove("hidden");
  viewerEl.innerHTML = "";

  const lower = file.name.toLowerCase();
  // stream to media element where sensible; fallback to blob
  if (/\.(mp4|webm)$/.test(lower)) {
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.autoplay = false;
    viewerEl.appendChild(video);
    // appendTo efficiently streams via MediaSource
    file.appendTo(video, (err) => {
      if (err) showBlobPreview(file, "video");
    });
    return;
  }
  if (/\.(mp3|m4a|wav|ogg)$/.test(lower)) {
    const audio = document.createElement("audio");
    audio.controls = true;
    viewerEl.appendChild(audio);
    file.appendTo(audio, (err) => {
      if (err) showBlobPreview(file, "audio");
    });
    return;
  }
  if (/\.(png|jpg|jpeg|gif|webp|bmp)$/.test(lower)) {
    // for images, blob is simple and memory-acceptable compared to appendTo
    showBlobPreview(file, "img");
    return;
  }

  // fallback: offer download
  const p = document.createElement("p");
  p.className = "tiny";
  p.textContent = "no inline preview available. use the download button instead.";
  viewerEl.appendChild(p);
}

async function showBlobPreview(file, kind) {
  try {
    const blob = await getFileBlob(file);
    const url = URL.createObjectURL(blob);
    if (kind === "video") {
      const el = document.createElement("video");
      el.controls = true;
      el.playsInline = true;
      el.src = url;
      viewerEl.appendChild(el);
    } else if (kind === "audio") {
      const el = document.createElement("audio");
      el.controls = true;
      el.src = url;
      viewerEl.appendChild(el);
    } else if (kind === "img") {
      const el = document.createElement("img");
      el.alt = file.name;
      el.src = url;
      viewerEl.appendChild(el);
    }
    // revoke later to keep it viewable for a while
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (e) {
    const p = document.createElement("p");
    p.className = "tiny";
    p.textContent = `preview failed: ${e?.message || e}`;
    viewerEl.appendChild(p);
  }
}

// accessibility and affordances
window.addEventListener("keydown", (e) => {
  // ctrl/cmd+v to paste magnet quickly into the field if not focused
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
    if (document.activeElement !== magnetInput) {
      magnetInput.focus();
    }
  }
});

// warn on unload if an active torrent exists
window.addEventListener("beforeunload", (e) => {
  if (currentTorrent && currentTorrent.downloaded < currentTorrent.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});