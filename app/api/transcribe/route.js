import { checkPassword } from "@/lib/auth";

export const maxDuration = 120;

// Receives one audio chunk (the browser splits long recordings) and returns its text via Groq Whisper.
export async function POST(request) {
  const denied = checkPassword(request);
  if (denied) return denied;

  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "Audio needs GROQ_API_KEY on the server. You can still paste a transcript." },
      { status: 500 }
    );
  }

  let file, prompt;
  try {
    const form = await request.formData();
    file = form.get("file");
    prompt = form.get("prompt");
  } catch {
    return Response.json({ error: "Could not read the uploaded audio." }, { status: 400 });
  }
  if (!file || typeof file === "string") {
    return Response.json({ error: "No audio file received." }, { status: 400 });
  }

  const out = new FormData();
  out.append("file", file, file.name || "audio.wav");
  out.append("model", "whisper-large-v3-turbo");
  out.append("response_format", "json");
  // Optional hint (previous words, names) that helps Whisper spell names right and stay consistent.
  if (typeof prompt === "string" && prompt.trim()) out.append("prompt", prompt.slice(-800));

  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: out,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    console.log(`[minutes] Groq audio failed: ${err.name} ${err.cause?.code || err.message}`);
    return Response.json(
      { error: "Couldn't reach Groq for transcription (timed out or blocked by your network)." },
      { status: 504 }
    );
  }

  if (!res.ok) {
    const detail = await res.text();
    return Response.json(
      { error: `Transcription failed (${res.status}). ${detail.slice(0, 300)}` },
      { status: 502 }
    );
  }
  const data = await res.json();
  return Response.json({ text: data.text || "" });
}
