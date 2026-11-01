import { buildSystemPrompt, MEETING_TYPES } from "@/lib/prompts";
import { checkPassword } from "@/lib/auth";
import { pickProvider, runSummary } from "@/lib/providers";

export const maxDuration = 300;

const MAX_CHARS = 600_000; // roughly 150k tokens, about 15+ hours of talking

export async function POST(request) {
  const denied = checkPassword(request);
  if (denied) return denied;

  const provider = pickProvider();
  if (!provider) {
    return Response.json(
      { error: "No AI key is set. Add a free GEMINI_API_KEY (or GROQ_API_KEY) to your environment variables." },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const transcript = (body.transcript || "").trim();
  const type = MEETING_TYPES[body.type] ? body.type : "auto";
  const context = (body.context || "").trim().slice(0, 2000);

  if (transcript.length < 30) {
    return Response.json({ error: "Transcript is too short to summarize." }, { status: 400 });
  }
  if (transcript.length > MAX_CHARS) {
    return Response.json({ error: "Transcript is too long. Split it into parts." }, { status: 400 });
  }

  const userText =
    (context ? `Context from the user about this meeting: ${context}\n\n` : "") +
    `<transcript>\n${transcript}\n</transcript>`;

  try {
    const { summary, used } = await runSummary(provider, buildSystemPrompt(type), userText);
    return Response.json({ summary, provider: used });
  } catch (err) {
    return Response.json({ error: err.message || "Something went wrong." }, { status: err.status || 500 });
  }
}
