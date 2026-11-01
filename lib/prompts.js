export const MEETING_TYPES = {
  auto: { label: "Auto-detect" },
  standup: { label: "Standup" },
  strategy: { label: "Strategy / planning" },
  research: { label: "User research" },
  general: { label: "General" },
};

const TYPE_GUIDE = {
  standup: `This is a STANDUP. Fill "standup_updates" with one entry per person (done, doing, blockers) and "blockers" with every blocker that needs someone's help. Keep key_points short; standups are about status, not discussion.`,
  strategy: `This is a STRATEGY / PLANNING meeting. Fill "options_considered" (each option with pros and cons actually mentioned), "risks" (risks or concerns raised), and make "decisions" thorough, including the reasoning behind each decision.`,
  research: `This is a USER RESEARCH session. Fill "insights" (each with the evidence from the transcript), "pain_points", "opportunities", and "user_quotes" (short verbatim quotes, under 25 words each, with the speaker label if known). Do not invent quotes. Action items are usually follow-up research or product tasks.`,
  general: `This is a general meeting. Focus on summary, key points, decisions, action items and follow-up questions.`,
};

export function buildSystemPrompt(type) {
  const guide =
    type === "auto"
      ? `First decide the meeting type (standup, strategy, research, or general) and set "detected_type". Then fill the type-specific fields that apply:\n- standup: ${TYPE_GUIDE.standup}\n- strategy: ${TYPE_GUIDE.strategy}\n- research: ${TYPE_GUIDE.research}\n- general: ${TYPE_GUIDE.general}`
      : `Set "detected_type" to "${type}". ${TYPE_GUIDE[type] || TYPE_GUIDE.general}`;

  return `You turn raw meeting transcripts into accurate, structured notes. Always respond by calling the save_summary tool.

Rules:
- Use only what is in the transcript. Never invent decisions, owners, or dates. If an owner or due date was not stated, use "Unassigned" or "No date".
- A decision is something the group agreed or committed to, not something merely discussed.
- An action item is a concrete task someone took on or was given. Write it as a clear verb phrase.
- follow_up_questions are things left unresolved, unclear, or that someone should find out.
- Transcripts may be messy (speech-to-text errors, no speaker labels). Infer carefully and stay faithful.
- Be concise. Leave arrays empty rather than padding them.

${guide}`;
}

const strArr = { type: "array", items: { type: "string" } };

export const SUMMARY_TOOL = {
  name: "save_summary",
  description: "Save the structured meeting summary.",
  input_schema: {
    type: "object",
    properties: {
      detected_type: { type: "string", enum: ["standup", "strategy", "research", "general"] },
      title: { type: "string", description: "Short descriptive title for the meeting" },
      summary: { type: "string", description: "2-4 sentence overview" },
      key_points: strArr,
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: { decision: { type: "string" }, context: { type: "string" } },
          required: ["decision"],
        },
      },
      action_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            task: { type: "string" },
            owner: { type: "string" },
            due: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["task", "owner", "due"],
        },
      },
      follow_up_questions: strArr,
      standup_updates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            person: { type: "string" },
            done: { type: "string" },
            doing: { type: "string" },
            blockers: { type: "string" },
          },
          required: ["person"],
        },
      },
      blockers: strArr,
      options_considered: {
        type: "array",
        items: {
          type: "object",
          properties: { option: { type: "string" }, pros: strArr, cons: strArr },
          required: ["option"],
        },
      },
      risks: strArr,
      insights: {
        type: "array",
        items: {
          type: "object",
          properties: { insight: { type: "string" }, evidence: { type: "string" } },
          required: ["insight"],
        },
      },
      pain_points: strArr,
      opportunities: strArr,
      user_quotes: {
        type: "array",
        items: {
          type: "object",
          properties: { quote: { type: "string" }, speaker: { type: "string" } },
          required: ["quote"],
        },
      },
    },
    required: ["detected_type", "title", "summary", "key_points", "decisions", "action_items", "follow_up_questions"],
  },
};
