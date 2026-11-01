const list = (title, items, fmt = (x) => x) =>
  items?.length ? `## ${title}\n${items.map((x) => `- ${fmt(x)}`).join("\n")}\n` : "";

export function toMarkdown(s, done = {}) {
  const typeLabel = { standup: "Standup", strategy: "Strategy", research: "User research", general: "General" };
  return [
    `# ${s.title}`,
    `_${typeLabel[s.detected_type] || "Meeting"} · summarized ${new Date().toLocaleDateString()}_\n`,
    `${s.summary}\n`,
    s.action_items?.length
      ? `## Action items\n${s.action_items
          .map(
            (a, i) =>
              `- [${done[i] ? "x" : " "}] ${a.task} (**${a.owner}**, ${a.due}${a.priority ? `, ${a.priority}` : ""})`
          )
          .join("\n")}\n`
      : "",
    list("Decisions", s.decisions, (d) => d.decision + (d.context ? ` (${d.context})` : "")),
    list("Follow-up questions", s.follow_up_questions),
    list("Key points", s.key_points),
    s.standup_updates?.length
      ? `## Updates by person\n${s.standup_updates
          .map(
            (u) =>
              `### ${u.person}\n` +
              (u.done ? `- Done: ${u.done}\n` : "") +
              (u.doing ? `- Doing: ${u.doing}\n` : "") +
              (u.blockers ? `- Blockers: ${u.blockers}\n` : "")
          )
          .join("")}`
      : "",
    list("Blockers", s.blockers),
    s.options_considered?.length
      ? `## Options considered\n${s.options_considered
          .map(
            (o) =>
              `### ${o.option}\n` +
              (o.pros?.length ? o.pros.map((p) => `- + ${p}`).join("\n") + "\n" : "") +
              (o.cons?.length ? o.cons.map((c) => `- − ${c}`).join("\n") + "\n" : "")
          )
          .join("")}`
      : "",
    list("Risks", s.risks),
    list("Insights", s.insights, (i) => i.insight + (i.evidence ? ` (evidence: ${i.evidence})` : "")),
    list("Pain points", s.pain_points),
    list("Opportunities", s.opportunities),
    list("Quotes", s.user_quotes, (q) => `"${q.quote}"${q.speaker ? ` (${q.speaker})` : ""}`),
  ]
    .filter(Boolean)
    .join("\n");
}
