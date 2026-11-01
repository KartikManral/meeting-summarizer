// Browser-only helpers. Vercel limits request bodies to ~4.5 MB, so long recordings
// are decoded in the browser, downsampled to 16 kHz mono and sent in short WAV chunks.

const DIRECT_LIMIT = 4 * 1024 * 1024;
const CHUNK_SECONDS = 100; // 100 s of 16 kHz 16-bit mono ≈ 3.2 MB

export async function transcribeFile(file, password, onProgress) {
  if (file.size <= DIRECT_LIMIT) {
    onProgress?.("Transcribing audio…");
    return sendChunk(file, password);
  }

  onProgress?.("Preparing audio (long files take a moment)…");
  const buffer = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  let audio;
  try {
    audio = await ctx.decodeAudioData(buffer);
  } catch {
    throw new Error("This browser couldn't read that audio format. Try MP3, M4A or WAV.");
  } finally {
    ctx.close?.();
  }

  const mono = toMono(audio);
  const rate = audio.sampleRate;
  const per = CHUNK_SECONDS * rate;
  const total = Math.ceil(mono.length / per);
  const parts = [];
  for (let i = 0; i < total; i++) {
    onProgress?.(`Transcribing part ${i + 1} of ${total}…`);
    const slice = mono.subarray(i * per, Math.min((i + 1) * per, mono.length));
    const wav = new File([encodeWav(slice, rate)], `part-${i + 1}.wav`, { type: "audio/wav" });
    parts.push(await sendChunk(wav, password));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function sendChunk(file, password) {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: password ? { "x-app-password": password } : {},
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Transcription failed (${res.status}).`);
  return data.text || "";
}

function toMono(audio) {
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / audio.numberOfChannels;
  }
  return out;
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

// Strip timestamps and cue numbers from .vtt / .srt caption files (Zoom, Meet, Teams exports).
export function cleanCaptions(text, name = "") {
  if (!/\.(vtt|srt)$/i.test(name) && !text.startsWith("WEBVTT")) return text;
  return text
    .split(/\r?\n/)
    .filter(
      (l) =>
        l.trim() &&
        l.trim() !== "WEBVTT" &&
        !/^\d+$/.test(l.trim()) &&
        !/-->/.test(l) &&
        !/^(NOTE|STYLE|Kind:|Language:)/.test(l.trim())
    )
    .map((l) => l.replace(/<v\s+([^>]+)>/g, "$1: ").replace(/<[^>]+>/g, ""))
    .join("\n");
}
