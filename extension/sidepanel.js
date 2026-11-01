const $ = (id) => document.getElementById(id);
const DEFAULT_URL = "https://meeting-summarizer-eight.vercel.app";
const AUTO_COOLDOWN_MS = 25_000;

let settings = {};
let lines = [];
let live = {};
let lastAutoCheck = 0;
let lastSeenCount = 0;

// ---------- settings ----------
async function loadSettings() {
  ({ settings = {} } = await chrome.storage.local.get("settings"));
  $("appUrl").value = settings.appUrl || DEFAULT_URL;
  $("password").value = settings.password || "";
  $("name").value = settings.name || "";
  $("aliases").value = settings.aliases || "";
  $("about").value = settings.about || "";
  $("withMic").checked = !!settings.withMic;
  if (!settings.name || !settings.appUrl) toggleSettings(true);
}

function toggleSettings(show) {
  $("settings").classList.toggle("hidden", !show);
}

$("gear").onclick = () => toggleSettings($("settings").classList.contains("hidden"));
$("micBtn").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("mic.html") });
$("save").onclick = async () => {
  settings = {
    appUrl: $("appUrl").value.trim().replace(/\/$/, "") || DEFAULT_URL,
    password: $("password").value,
    name: $("name").value.trim(),
    aliases: $("aliases").value.trim(),
    about: $("about").value.trim(),
    withMic: $("withMic").checked,
  };
  await chrome.storage.local.set({ settings });
  $("saved").textContent = "Saved";
  setTimeout(() => {
    $("saved").textContent = "";
    if (settings.name) toggleSettings(false);
  }, 700);
};

// ---------- start / stop ----------
$("startBtn").onclick = async () => {
  showErr("");
  if (live.status === "listening" || live.status === "starting") {
    chrome.runtime.sendMessage({ type: "stop" });
    return;
  }
  if (!settings.name) {
    toggleSettings(true);
    return showErr("Add your name in settings first, so I know when someone's talking to you.");
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || /^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    return showErr("Switch to your meeting tab first.");
  }
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (e) {
    return showErr(
      "Chrome needs you to click the Minutes icon (in the toolbar) while you're on the meeting tab. Do that, then press Start again."
    );
  }
  await chrome.storage.local.set({ lines: [] });
  lastSeenCount = 0;
  $("answer").classList.add("hidden");
  chrome.runtime.sendMessage({
    type: "start",
    tabTitle: tab.title,
    payload: {
      streamId,
      withMic: settings.withMic,
      appUrl: settings.appUrl,
      password: settings.password,
      name: settings.name,
      aliases: settings.aliases,
    },
  });
};

// ---------- rendering ----------
function nameRegex() {
  const base = [settings.name, ...(settings.aliases || "").split(",")]
    .map((s) => (s || "").trim())
    .filter((s) => s.length >= 2);
  if (!base.length) return null;
  // Speech-to-text often swaps "t"/"th" (Kartik / Karthik), so accept both.
  const parts = base.map((n) =>
    n
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/th|t/gi, "t(?:h)?")
  );
  return new RegExp(`\\b(${parts.join("|")})\\b`, "i");
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function renderTranscript() {
  const box = $("transcript");
  if (!lines.length) {
    box.innerHTML = '<p class="muted small">Nothing yet. Lines appear about every 10 seconds while people talk.</p>';
    return;
  }
  const re = nameRegex();
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = lines
    .map((l) => {
      let html = esc(l.text);
      if (re) html = html.replace(new RegExp(re.source, "gi"), (m) => `<mark>${m}</mark>`);
      return `<p><span class="ts">${fmtTime(l.t - (live.startedAt || l.t))}</span>${html}</p>`;
    })
    .join("");
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function renderStatus() {
  const on = live.status === "listening" || live.status === "starting";
  $("dot").className = "dot" + (on ? " on" : "");
  $("statusText").textContent =
    live.status === "starting" ? "Starting…" : on ? `Listening${live.tabTitle ? " to " + live.tabTitle.slice(0, 32) : ""}` : "Not listening";
  $("startBtn").textContent = on ? "Stop listening" : "Start listening to this tab";
  $("startBtn").classList.toggle("stop", on);
  $("hint").classList.toggle("hidden", on || lines.length > 0);
  showErr(live.error || (on ? live.lastChunkError : "") || "");
}

setInterval(() => {
  const on = live.status === "listening";
  $("timer").textContent = on && live.startedAt ? fmtTime(Date.now() - live.startedAt) : "";
}, 1000);

function showErr(text) {
  $("err").textContent = text;
  $("err").classList.toggle("hidden", !text);
}

// ---------- AI help ----------
const transcriptText = () => lines.map((l) => l.text).join("\n");

async function callLive(mode, extra = {}) {
  const res = await fetch(settings.appUrl + "/api/live", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.password ? { "x-app-password": settings.password } : {}),
    },
    body: JSON.stringify({
      mode,
      transcript: transcriptText(),
      name: [settings.name, settings.aliases].filter(Boolean).join(" / "),
      about: settings.about,
      ...extra,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data.result;
}

function showLoading(label) {
  const a = $("answer");
  a.className = "card answer";
  a.innerHTML = `<p class="muted">${label}</p>`;
}

function showAnswerError(msg) {
  $("answer").className = "card answer";
  $("answer").innerHTML = `<p class="bad-text">${esc(msg)}</p>`;
}

function renderAsked(r, auto) {
  const a = $("answer");
  a.className = "card answer" + (r.found ? " alert" : "");
  a.innerHTML = `
    <div class="aHead">${r.found ? (auto ? "🔔 Someone's talking to you" : "🙋 You were asked") : "No question for you; latest open question"}</div>
    <p class="q">${esc(r.question || "")}</p>
    ${r.asked_by ? `<p class="muted small">Asked by ${esc(r.asked_by)}</p>` : ""}
    ${r.context ? `<p class="small ctx">${esc(r.context)}</p>` : ""}
    <div class="reply">
      <div class="label">You could say</div>
      <p>${esc(r.suggested_reply || "")}</p>
      <button class="link small copy" data-copy="${esc(r.suggested_reply || "")}">Copy</button>
    </div>
    ${r.alt_reply ? `<div class="reply alt"><div class="label">If you're not sure</div><p>${esc(r.alt_reply)}</p></div>` : ""}
    <button class="link small dismiss">Dismiss</button>`;
  bindAnswerButtons();
  if (auto && r.found) beep();
}

function renderCatchup(r) {
  const a = $("answer");
  a.className = "card answer";
  a.innerHTML = `
    <div class="aHead">⏪ Last few minutes</div>
    <ul>${(r.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
    ${r.for_you ? `<div class="reply"><div class="label">For you</div><p>${esc(r.for_you)}</p></div>` : ""}
    <button class="link small dismiss">Dismiss</button>`;
  bindAnswerButtons();
}

function renderAsk(q, r) {
  const a = $("answer");
  a.className = "card answer";
  a.innerHTML = `<div class="aHead">💬 ${esc(q)}</div><p>${esc(r.answer || "")}</p><button class="link small dismiss">Dismiss</button>`;
  bindAnswerButtons();
}

function bindAnswerButtons() {
  $("answer").querySelectorAll(".dismiss").forEach((b) => (b.onclick = () => $("answer").classList.add("hidden")));
  $("answer").querySelectorAll(".copy").forEach(
    (b) =>
      (b.onclick = async () => {
        await navigator.clipboard.writeText(b.dataset.copy);
        b.textContent = "Copied";
      })
  );
}

function needTranscript() {
  if (transcriptText().length < 20) {
    showAnswerError("Not enough has been said yet. Lines appear about every 10 seconds.");
    return false;
  }
  return true;
}

$("askedBtn").onclick = async () => {
  if (!needTranscript()) return;
  showLoading("Finding what you were asked…");
  try {
    renderAsked(await callLive("asked"), false);
  } catch (e) {
    showAnswerError(e.message);
  }
};

$("missBtn").onclick = async () => {
  if (!needTranscript()) return;
  showLoading("Catching you up…");
  try {
    renderCatchup(await callLive("catchup"));
  } catch (e) {
    showAnswerError(e.message);
  }
};

$("askForm").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("askInput").value.trim();
  if (!q || !needTranscript()) return;
  showLoading("Thinking…");
  try {
    renderAsk(q, await callLive("ask", { question: q }));
    $("askInput").value = "";
  } catch (err) {
    showAnswerError(err.message);
  }
};

// When your name shows up in a new line, check automatically whether you were asked something.
async function autoCheck(newLines) {
  const re = nameRegex();
  if (!re || !newLines.some((l) => re.test(l.text))) return;
  if (Date.now() - lastAutoCheck < AUTO_COOLDOWN_MS) return;
  lastAutoCheck = Date.now();
  try {
    const r = await callLive("asked");
    if (r.found) renderAsked(r, true);
  } catch {}
}

function beep() {
  try {
    const a = new AudioContext();
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + 0.35);
  } catch {}
}

// ---------- footer actions ----------
$("copyBtn").onclick = async () => {
  await navigator.clipboard.writeText(transcriptText());
  $("copyBtn").textContent = "Copied";
  setTimeout(() => ($("copyBtn").textContent = "Copy"), 1200);
};

$("sumBtn").onclick = () => {
  const text = transcriptText();
  if (!text) return showErr("No transcript yet.");
  chrome.tabs.create({ url: `${settings.appUrl}/#transcript=${encodeURIComponent(text)}` });
};

// ---------- sync with storage ----------
async function loadState() {
  ({ lines = [], live = {} } = await chrome.storage.local.get(["lines", "live"]));
  lastSeenCount = lines.length;
  renderTranscript();
  renderStatus();
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.live) {
    live = changes.live.newValue || {};
    renderStatus();
  }
  if (changes.lines) {
    lines = changes.lines.newValue || [];
    const fresh = lines.slice(lastSeenCount);
    lastSeenCount = lines.length;
    renderTranscript();
    renderStatus();
    if (fresh.length && live.status === "listening") autoCheck(fresh);
  }
  if (changes.settings) {
    settings = changes.settings.newValue || {};
    $("withMic").checked = !!settings.withMic;
  }
});

loadSettings().then(loadState);
