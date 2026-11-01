// Hidden page that records the meeting tab (plus, optionally, your mic) in short chunks
// and sends each chunk to your Minutes app for transcription.

const CHUNK_MS = 8_000; // shorter = alerts arrive sooner
const SILENCE_RMS = 0.006; // skip chunks that are basically silent (Whisper invents words on silence)
const JUNK = /^(thank you\.?|thanks for watching!?|you|bye\.?|\.+|\s*)$/i;

let running = false;
let ctx, dest, analyser, tabStream, micStream;
let recorder, chunkTimer, levelTimer;
let peak = 0;
let cfg = {};
let lastText = "";
let queue = Promise.resolve();

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "start") start(msg);
  if (msg.type === "stop") stop();
});

async function start(msg) {
  if (running) return;
  cfg = msg;
  lastText = "";
  try {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: msg.streamId } },
      video: false,
    });
  } catch (e) {
    send({ type: "rec-status", status: "stopped", error: "Couldn't capture the tab's audio: " + e.message });
    return;
  }

  ctx = new AudioContext();
  dest = ctx.createMediaStreamDestination();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;

  const tabSrc = ctx.createMediaStreamSource(tabStream);
  tabSrc.connect(ctx.destination); // keep the meeting audible to you
  tabSrc.connect(dest);
  tabSrc.connect(analyser);

  if (msg.withMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const micSrc = ctx.createMediaStreamSource(micStream);
      micSrc.connect(dest);
      micSrc.connect(analyser);
    } catch {
      send({ type: "rec-error", error: "Microphone not allowed, so only the meeting audio is recorded. Use 'Allow microphone' in settings." });
    }
  }

  tabStream.getAudioTracks()[0].addEventListener("ended", stop);

  const buf = new Float32Array(analyser.fftSize);
  levelTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    peak = Math.max(peak, Math.sqrt(sum / buf.length));
  }, 200);

  running = true;
  startRecorder();
  send({ type: "rec-status", status: "listening" });
}

function startRecorder() {
  const rec = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus" });
  const parts = [];
  const startedAt = Date.now();
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  rec.onstop = () => {
    const level = peak;
    peak = 0;
    if (level < SILENCE_RMS || !parts.length) return;
    const blob = new Blob(parts, { type: "audio/webm" });
    queue = queue.then(() => transcribe(blob, startedAt));
  };
  rec.start();
  recorder = rec;
  chunkTimer = setTimeout(() => {
    if (!running) return;
    const old = recorder;
    startRecorder(); // start the next chunk first so no words fall in a gap
    old.stop();
  }, CHUNK_MS);
}

async function transcribe(blob, t) {
  const form = new FormData();
  form.append("file", blob, "chunk.webm");
  const names = [cfg.name, cfg.aliases].filter(Boolean).join(", ");
  // Hints that steer Whisper: names spelled right, and Roman-script Hinglish if chosen.
  const langHint =
    cfg.language === "hinglish"
      ? "Hinglish meeting, Hindi words written in English letters: haan, theek hai, toh, kal tak, ho jayega. "
      : "";
  form.append("prompt", langHint + (names ? `Meeting with ${names}. ` : "") + lastText.slice(-300));
  if (cfg.language === "en" || cfg.language === "hi") form.append("language", cfg.language);
  try {
    const res = await fetch(cfg.appUrl.replace(/\/$/, "") + "/api/transcribe", {
      method: "POST",
      headers: cfg.password ? { "x-app-password": cfg.password } : {},
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      send({ type: "rec-error", error: data.error || `Transcription failed (${res.status})` });
      if (res.status === 401) stop("Wrong app password. Fix it in settings.");
      return;
    }
    const text = (data.text || "").trim();
    if (!text || JUNK.test(text)) return;
    lastText = text;
    send({ type: "rec-text", t, text });
    send({ type: "rec-error", error: "" });
  } catch (e) {
    send({ type: "rec-error", error: "Couldn't reach your Minutes app: " + e.message });
  }
}

async function stop(error) {
  if (!running) return;
  running = false;
  clearTimeout(chunkTimer);
  clearInterval(levelTimer);
  try {
    recorder?.stop(); // flush the last few seconds
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
  await queue;
  [tabStream, micStream].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
  ctx?.close();
  send({ type: "rec-status", status: "stopped", error: typeof error === "string" ? error : "" });
}
