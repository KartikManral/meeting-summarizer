import Anthropic from "@anthropic-ai/sdk";
import { SUMMARY_TOOL } from "@/lib/prompts";

// Which AI writes the summary. Set AI_PROVIDER to force one; otherwise the first key found wins.
// With both free keys, "free-auto" uses Groq (very fast) for normal meetings and Gemini for long ones.
export function pickProvider() {
  const forced = (process.env.AI_PROVIDER || "").toLowerCase();
  if (forced) return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY && process.env.GROQ_API_KEY) return "free-auto";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  return null;
}

// Groq's free tier allows ~12k tokens per minute including the reply, so keep input to ~6k tokens.
const GROQ_MAX_CHARS = 24_000;

// Never wait forever on an AI service: give up after `ms` and report it clearly.
async function timedFetch(name, url, opts, ms) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
    console.log(`[minutes] ${name} -> ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return res;
  } catch (err) {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[minutes] ${name} failed after ${secs}s: ${err.name} ${err.cause?.code || err.message}`);
    if (err.name === "TimeoutError" || err.name === "AbortError")
      throw new ProviderError(`${name} didn't answer within ${ms / 1000}s.`, 504);
    throw new ProviderError(
      `Couldn't reach ${name} (${err.cause?.code || err.message}). Your internet or network may be blocking it.`,
      503
    );
  }
}

export class ProviderError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

const schemaText = () =>
  `\n\nReply with ONLY a JSON object (no markdown, no code fences) matching this JSON Schema:\n${JSON.stringify(
    SUMMARY_TOOL.input_schema
  )}`;

function parseJson(text) {
  const cleaned = (text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new ProviderError("The AI returned something that wasn't a summary. Try again.", 502);
  }
}

async function anthropic(system, user) {
  const client = new Anthropic();
  try {
    const msg = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
      max_tokens: 8000,
      system,
      tools: [SUMMARY_TOOL],
      tool_choice: { type: "tool", name: "save_summary" },
      messages: [{ role: "user", content: user }],
    });
    const tool = msg.content.find((c) => c.type === "tool_use");
    if (!tool) throw new ProviderError("Claude did not return a summary. Try again.", 502);
    return tool.input;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err?.status === 401) throw new ProviderError("Your Anthropic API key was rejected.", 401);
    if (err?.status === 429) throw new ProviderError("Rate limited by Anthropic. Wait a minute and try again.", 429);
    throw new ProviderError(err?.message || "Claude request failed.", err?.status || 500);
  }
}

// Google retires model names often, so try a few current ones in order.
const GEMINI_FALLBACKS = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.6-flash", "gemini-3.5-flash-lite"];

async function gemini(system, user) {
  const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : GEMINI_FALLBACKS;
  let lastErr;
  for (const model of models) {
    try {
      return await geminiWith(model, system, user);
    } catch (err) {
      lastErr = err;
      if (!err.notFound) throw err;
    }
  }
  throw lastErr;
}

async function geminiWith(model, system, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Summaries don't need deep "thinking"; turning it down makes Gemini several times faster.
  const thinking = /gemini-3|latest/.test(model) ? { thinkingLevel: "low" } : { thinkingBudget: 0 };

  const call = (withSchema, withThinking) =>
    timedFetch(`Gemini (${model})`, url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system + (withSchema ? "" : schemaText()) }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          ...(withSchema ? { responseJsonSchema: SUMMARY_TOOL.input_schema } : {}),
          ...(withThinking ? { thinkingConfig: thinking } : {}),
        },
      }),
    }, 90_000);

  let res = await call(true, true);
  // If a model rejects one of the newer options, retry with fewer of them.
  if (res.status === 400) res = await call(true, false);
  if (res.status === 400) res = await call(false, false);

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    if (res.status === 429)
      throw new ProviderError("Gemini's free limit was hit. Wait a minute (or until tomorrow) and try again.", 429);
    if (res.status === 400 && /API key/i.test(detail))
      throw new ProviderError("Your Gemini API key was rejected. Check GEMINI_API_KEY.", 401);
    if (res.status === 404) {
      const e = new ProviderError(
        `Gemini model "${model}" isn't available to your key. Set GEMINI_MODEL to a current Flash model (see ai.google.dev/gemini-api/docs/models).`,
        502
      );
      e.notFound = true;
      throw e;
    }
    throw new ProviderError(`Gemini request failed (${res.status}). ${detail}`, 502);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
  if (!text) throw new ProviderError("Gemini returned an empty reply. Try again.", 502);
  return parseJson(text);
}

async function groq(system, user) {
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const res = await timedFetch("Groq", "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system + schemaText() },
        { role: "user", content: user },
      ],
    }),
  }, 30_000);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    if (res.status === 413 || (res.status === 429 && /tokens per minute|TPM|too large/i.test(detail)))
      throw new ProviderError(
        "This meeting is too long for Groq's free limit (about 30–40 minutes of talk). Add a free GEMINI_API_KEY for longer meetings.",
        413
      );
    if (res.status === 429) throw new ProviderError("Groq's free limit was hit. Wait a minute and try again.", 429);
    if (res.status === 401) throw new ProviderError("Your Groq API key was rejected. Check GROQ_API_KEY.", 401);
    throw new ProviderError(`Groq request failed (${res.status}). ${detail}`, 502);
  }
  const data = await res.json();
  return parseJson(data.choices?.[0]?.message?.content);
}

async function freeAuto(system, user) {
  if (user.length <= GROQ_MAX_CHARS) {
    try {
      return { result: await groq(system, user), used: "groq" };
    } catch (err) {
      // Too big or rate-limited on Groq: quietly hand it to Gemini instead.
      if (![413, 429, 502, 503, 504].includes(err.status)) throw err;
      console.log("[minutes] Groq didn't work, switching to Gemini");
    }
  }
  return { result: await gemini(system, user), used: "gemini" };
}

const PROVIDERS = { anthropic, gemini, groq };

export async function runSummary(provider, system, user) {
  if (provider === "free-auto") {
    const { result, used } = await freeAuto(system, user);
    return { summary: normalize(result), used };
  }
  return { summary: await runSingle(provider, system, user), used: provider };
}

async function runSingle(provider, system, user) {
  const fn = PROVIDERS[provider];
  if (!fn) throw new ProviderError(`Unknown AI_PROVIDER "${provider}". Use gemini, groq or anthropic.`, 500);
  return normalize(await fn(system, user));
}

// Free models occasionally skip fields or use slightly different shapes; tidy that up.
function normalize(s) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const out = { ...s };
  out.detected_type = ["standup", "strategy", "research", "general"].includes(s.detected_type)
    ? s.detected_type
    : "general";
  out.title = str(s.title) || "Meeting summary";
  out.summary = str(s.summary);
  for (const k of ["key_points", "follow_up_questions", "blockers", "risks", "pain_points", "opportunities"])
    out[k] = arr(s[k]).map(str).filter(Boolean);
  out.decisions = arr(s.decisions).map((d) => (typeof d === "string" ? { decision: d } : d)).filter((d) => d?.decision);
  out.action_items = arr(s.action_items)
    .map((a) => (typeof a === "string" ? { task: a } : a))
    .filter((a) => a?.task)
    .map((a) => ({
      ...a,
      owner: str(a.owner) || "Unassigned",
      due: str(a.due) || "No date",
      priority: ["high", "medium", "low"].includes(a.priority) ? a.priority : undefined,
    }));
  out.standup_updates = arr(s.standup_updates).filter((u) => u?.person);
  out.options_considered = arr(s.options_considered)
    .filter((o) => o?.option)
    .map((o) => ({ ...o, pros: arr(o.pros).map(str), cons: arr(o.cons).map(str) }));
  out.insights = arr(s.insights).map((i) => (typeof i === "string" ? { insight: i } : i)).filter((i) => i?.insight);
  out.user_quotes = arr(s.user_quotes).map((q) => (typeof q === "string" ? { quote: q } : q)).filter((q) => q?.quote);
  return out;
}
