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
  $("language").value = settings.language || "auto";
  $("style").value = settings.style || "natural";
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
    language: $("language").value,
    style: $("style").value,
  };
  await chrome.storage.local.set({ settings });
  $("saved").textContent = "Saved";
  setTimeout(() => {
    $("saved").textContent = "";
    if (settings.name) toggleSettings(false);
  }, 700);
  // Clear the "fill in settings" message once they're saved.
  if (settings.name && /settings/i.test(live.error || "")) {
    const { live: l = {} } = await chrome.storage.local.get("live");
    await chrome.storage.local.set({ live: { ...l, error: "" } });
  }
};

// ---------- start / stop ----------
$("startBtn").onclick = () => chrome.runtime.sendMessage({ type: "stop" });

// ---------- rendering ----------
// ---------- name matching ----------
// Speech-to-text misspells names (Kartik → Karthik, Cartik, Kartic), so compare "sounds-alike" forms
// and allow one letter of difference for longer names.
function simplify(w) {
  return w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/th/g, "t")
    .replace(/ph/g, "f")
    .replace(/ck|c|q/g, "k")
    .replace(/w/g, "v")
    .replace(/(.)\1+/g, "$1")
    .replace(/[^a-z\u0900-\u097f]/g, "");
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function myNames() {
  return [settings.name, ...(settings.aliases || "").split(",")]
    .map((n) => simplify((n || "").trim()))
    .filter((n) => n.length >= 2);
}

function isMyName(word, names = myNames()) {
  const w = simplify(word);
  if (w.length < 2) return false;
  return names.some((n) => w === n || (n.length >= 5 && editDistance(w, n) <= 1));
}

const WORD = /[\p{L}\p{M}']+/gu;
const mentionsMe = (text) => (text.match(WORD) || []).some((w) => isMyName(w));

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function renderTranscript() {
  const box = $("transcript");
  if (!lines.length) {
    box.innerHTML = '<p class="muted small">Nothing yet. Lines appear about every 8 seconds while people talk.</p>';
    return;
  }
  const names = myNames();
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = lines
    .map((l) => {
      const html = esc(l.text).replace(WORD, (w) => (isMyName(w, names) ? `<mark>${w}</mark>` : w));
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
  $("startBtn").classList.toggle("hidden", !on);
  $("howto").classList.toggle("hidden", on);
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
      style: settings.style || "natural",
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
    showAnswerError("Not enough has been said yet. Lines appear about every 8 seconds.");
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

// When your name shows up, check whether you're actually being asked something.
// If the question isn't finished yet, check once more when the next line arrives.
let retryOnNextLine = false;
let lastAlertQuestion = "";

async function autoCheck(newLines) {
  const named = newLines.some((l) => mentionsMe(l.text));
  if (!named && !retryOnNextLine) return;
  if (named && Date.now() - lastAutoCheck < AUTO_COOLDOWN_MS && !retryOnNextLine) return;
  const isRetry = !named && retryOnNextLine;
  retryOnNextLine = false;
  lastAutoCheck = Date.now();
  try {
    const latest = lines.slice(-3).map((l) => l.text).join("\n");
    const r = await callLive("asked", { auto: true, latest });
    if (r.found) {
      const q = (r.question || "").toLowerCase();
      if (q && q === lastAlertQuestion) return; // don't alert twice for the same question
      lastAlertQuestion = q;
      renderAsked(r, true);
    } else if (!isRetry) {
      retryOnNextLine = true; // the question may continue in the next few seconds
    }
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

// ---------- past meetings ----------
let meetings = [];

function renderPast() {
  const box = $("past");
  $("pastBox").classList.toggle("hidden", !meetings.length);
  box.innerHTML = meetings
    .map((m) => {
      const d = new Date(m.startedAt);
      const mins = Math.max(1, Math.round((m.endedAt - m.startedAt) / 60000));
      return `<div class="pastItem" data-id="${m.id}">
        <div class="info"><div class="t">${esc(m.title)}</div>
        <div class="m">${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${mins} min</div></div>
        <button class="link sum">Summary ↗</button>
        <button class="link copyp">Copy</button>
        <button class="link del" title="Delete">×</button>
      </div>`;
    })
    .join("");
  box.querySelectorAll(".pastItem").forEach((el) => {
    const m = meetings.find((x) => x.id === el.dataset.id);
    const text = m.lines.map((l) => l.text).join("\n");
    el.querySelector(".sum").onclick = () =>
      chrome.tabs.create({ url: `${settings.appUrl}/#transcript=${encodeURIComponent(text)}` });
    el.querySelector(".copyp").onclick = async (e) => {
      await navigator.clipboard.writeText(text);
      e.target.textContent = "Copied";
    };
    el.querySelector(".del").onclick = () =>
      chrome.storage.local.set({ meetings: meetings.filter((x) => x.id !== m.id) });
  });
}

// ---------- sync with storage ----------
async function loadState() {
  ({ lines = [], live = {}, meetings = [] } = await chrome.storage.local.get(["lines", "live", "meetings"]));
  lastSeenCount = lines.length;
  renderPast();
  renderTranscript();
  renderStatus();
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.live) {
    const was = live.status;
    live = changes.live.newValue || {};
    if (live.status === "starting" && was !== "starting") {
      lastSeenCount = 0;
      retryOnNextLine = false;
      lastAlertQuestion = "";
      $("answer").classList.add("hidden");
    }
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
  if (changes.meetings) {
    meetings = changes.meetings.newValue || [];
    renderPast();
  }
  if (changes.settings) {
    settings = changes.settings.newValue || {};
    $("withMic").checked = !!settings.withMic;
  }
});

loadSettings().then(loadState);
