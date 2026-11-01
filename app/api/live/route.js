import { checkPassword } from "@/lib/auth";
import { quickJson } from "@/lib/providers";

export const maxDuration = 60;

// Used by the Chrome extension while a meeting is happening.
// mode "asked":   find the latest question aimed at the user and draft a reply
// mode "catchup": what happened in the last few minutes
// mode "ask":     answer the user's own question about the meeting so far

const RECENT_CHARS = 3500; // ~3 minutes of talk
const EARLIER_CHARS = 6000; // older context, kept small for Groq's free limits

const s = (desc) => ({ type: "string", description: desc });

const SCHEMAS = {
  asked: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "true if someone asked or requested something from the user" },
      question: s("The question or request, rewritten clearly in one sentence"),
      asked_by: s("Who asked, if it can be told from the transcript; otherwise empty"),
      context: s("1-2 sentences on what led up to the question"),
      suggested_reply: s("What the user could say out loud now: first person, natural, 1-3 short sentences"),
      alt_reply: s("A safe alternative if the user doesn't know: buy time politely or promise a follow-up"),
    },
    required: ["found", "question", "suggested_reply"],
  },
  catchup: {
    type: "object",
    properties: {
      bullets: { type: "array", items: { type: "string" }, description: "2-5 short bullets, most important first" },
      for_you: s("Anything aimed at the user or that they should react to; empty if nothing"),
    },
    required: ["bullets"],
  },
  ask: {
    type: "object",
    properties: { answer: s("Short, direct answer grounded only in the transcript") },
    required: ["answer"],
  },
};

function systemPrompt(mode, name, about) {
  const who = `The user is ${name || "the listener"}${about ? `. About them: ${about}` : ""}.`;
  const base = `You are a live meeting assistant sitting next to the user during a meeting. ${who}
The transcript is live speech-to-text: no speaker labels, some words may be wrong (names especially), and the user's own voice may be missing. Use only what is in the transcript; never invent facts, numbers or commitments.`;

  if (mode === "asked")
    return `${base}
The user lost focus and needs to know what they were just asked. Look mainly at the RECENT part (the end is the newest). Find the most recent question or request directed at the user: by name, by role, or a question to the group that is waiting for the user's input. If nothing was asked of them, set found=false and put the latest open question to the group in "question" anyway, with a reply they could give.
The suggested_reply must sound like a person talking in a meeting, not an email. If answering needs facts the transcript doesn't contain, give a reply that engages honestly and offers to confirm (e.g. "I'll check the numbers and update everyone by tomorrow").`;
  if (mode === "catchup")
    return `${base}
The user zoned out for the RECENT part. Tell them what they missed: decisions, new topics, tasks handed out, questions asked. Be brief; they're reading this while the meeting continues.`;
  return `${base}
Answer the user's question about the meeting so far in 1-3 sentences. If the transcript doesn't say, say so.`;
}

export async function POST(request) {
  const denied = checkPassword(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const mode = SCHEMAS[body.mode] ? body.mode : null;
  if (!mode) return Response.json({ error: "Unknown mode." }, { status: 400 });

  const transcript = String(body.transcript || "").trim();
  if (transcript.length < 20) {
    return Response.json({ error: "Not enough has been said yet." }, { status: 400 });
  }

  const recent = transcript.slice(-RECENT_CHARS);
  const earlier = transcript.slice(0, -RECENT_CHARS).slice(-EARLIER_CHARS);
  const name = String(body.name || "").slice(0, 100);
  const about = String(body.about || "").slice(0, 400);
  const question = String(body.question || "").slice(0, 500);

  const user =
    (earlier ? `<earlier>\n${earlier}\n</earlier>\n\n` : "") +
    `<recent>\n${recent}\n</recent>` +
    (mode === "ask" ? `\n\nThe user's question: ${question}` : "");

  try {
    const result = await quickJson(systemPrompt(mode, name, about), user, SCHEMAS[mode], 1200);
    return Response.json({ result });
  } catch (err) {
    return Response.json({ error: err.message || "Something went wrong." }, { status: err.status || 500 });
  }
}
