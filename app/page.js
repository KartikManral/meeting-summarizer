"use client";

import { useEffect, useRef, useState } from "react";
import { MEETING_TYPES } from "@/lib/prompts";
import { transcribeFile, cleanCaptions } from "@/lib/audio";
import { toMarkdown } from "@/lib/markdown";

const HISTORY_KEY = "minutes.history.v1";
const PASS_KEY = "minutes.password";
const TYPE_LABEL = { standup: "Standup", strategy: "Strategy", research: "User research", general: "General" };

const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

export default function Home() {
  const [status, setStatus] = useState(null);
  const [password, setPassword] = useState("");
  const [type, setType] = useState("auto");
  const [context, setContext] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(null); // { id, summary, done, createdAt, transcript }
  const [history, setHistory] = useState([]);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({}));
    setHistory(store.get(HISTORY_KEY, []));
    setPassword(store.get(PASS_KEY, ""));
  }, []);

  const headers = (extra = {}) => ({ ...extra, ...(password ? { "x-app-password": password } : {}) });

  function saveHistory(next) {
    setHistory(next);
    store.set(HISTORY_KEY, next.slice(0, 50));
  }

  async function handleFile(file) {
    if (!file) return;
    setError("");
    const isAudio = file.type.startsWith("audio/") || file.type.startsWith("video/") ||
      /\.(mp3|m4a|wav|webm|ogg|mp4|aac|flac)$/i.test(file.name);
    if (isAudio) {
      if (status && !status.audio) {
        setError("Audio transcription isn't set up yet (needs GROQ_API_KEY). You can paste a transcript instead.");
        return;
      }
      try {
        const text = await transcribeFile(file, password, setBusy);
        setTranscript(text);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy("");
      }
    } else {
      const text = await file.text();
      setTranscript(cleanCaptions(text, file.name));
    }
  }

  async function summarize() {
    setError("");
    const started = Date.now();
    setBusy("Reading the meeting…");
    const timer = setInterval(
      () => setBusy(`Reading the meeting… ${Math.round((Date.now() - started) / 1000)}s`),
      1000
    );
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ transcript, type, context }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
      const entry = {
        id: Date.now().toString(36),
        createdAt: new Date().toISOString(),
        summary: data.summary,
        done: {},
        transcript,
      };
      setCurrent(entry);
      saveHistory([entry, ...history]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e.message);
    } finally {
      clearInterval(timer);
      setBusy("");
    }
  }

  function toggleDone(i) {
    const next = { ...current, done: { ...current.done, [i]: !current.done[i] } };
    setCurrent(next);
    saveHistory(history.map((h) => (h.id === next.id ? next : h)));
  }

  function removeEntry(id) {
    saveHistory(history.filter((h) => h.id !== id));
    if (current?.id === id) setCurrent(null);
  }

  async function copyMd() {
    await navigator.clipboard.writeText(toMarkdown(current.summary, current.done));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadMd() {
    const blob = new Blob([toMarkdown(current.summary, current.done)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${current.summary.title.replace(/[^\w\- ]+/g, "").trim() || "meeting"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">M</span> Minutes
        </div>
        <button className="new" onClick={() => { setCurrent(null); setTranscript(""); setContext(""); setError(""); }}>
          + New summary
        </button>
        <div className="histLabel">Recent</div>
        {history.length === 0 && <p className="muted small">Summaries you make are kept in this browser.</p>}
        <ul className="hist">
          {history.map((h) => (
            <li key={h.id} className={current?.id === h.id ? "active" : ""}>
              <button onClick={() => setCurrent(h)}>
                <span className="hTitle">{h.summary.title}</span>
                <span className="hMeta">
                  {TYPE_LABEL[h.summary.detected_type]} · {new Date(h.createdAt).toLocaleDateString()}
                </span>
              </button>
              <button className="x" title="Delete" onClick={() => removeEntry(h.id)}>×</button>
            </li>
          ))}
        </ul>
        {status?.passwordRequired && (
          <label className="pw">
            <span>App password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); store.set(PASS_KEY, e.target.value); }}
            />
          </label>
        )}
      </aside>

      <main className="main">
        {current ? (
          <Summary entry={current} onToggle={toggleDone} onCopy={copyMd} onDownload={downloadMd} copied={copied} />
        ) : (
          <section className="composer">
            <h1>What happened in the meeting?</h1>
            <p className="lede">Paste a transcript or drop a recording. You get the decisions, who owes what, and what's still open.</p>

            <div className="types" role="radiogroup" aria-label="Meeting type">
              {Object.entries(MEETING_TYPES).map(([k, v]) => (
                <button key={k} role="radio" aria-checked={type === k} className={type === k ? "on" : ""} onClick={() => setType(k)}>
                  {v.label}
                </button>
              ))}
            </div>

            <div
              className={`drop ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
            >
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={"Paste the transcript here…\n\nOr drop a file: .txt, .vtt, .srt (Zoom / Meet / Teams captions), or audio (.mp3, .m4a, .wav)."}
              />
              <div className="dropBar">
                <button className="ghost" onClick={() => fileRef.current?.click()} disabled={!!busy}>Upload file</button>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept=".txt,.md,.vtt,.srt,audio/*,video/mp4,video/webm"
                  onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ""; }}
                />
                <span className="muted small">{words ? `${words.toLocaleString()} words` : status?.audio === false ? "Audio needs a Groq key" : ""}</span>
              </div>
            </div>

            <input
              className="ctx"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Optional context: who was there, what the project is, names to spell right…"
            />

            {status && status.summaries === false && (
              <div className="error">
                No AI key is set up yet. Add a free GEMINI_API_KEY (see the README), then restart the app.
              </div>
            )}
            {error && <div className="error">{error}</div>}

            <button className="primary" onClick={summarize} disabled={!!busy || words < 5}>
              {busy || "Summarize"}
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <section className="block">
      <h2>{title}{count != null && <span className="count">{count}</span>}</h2>
      {children}
    </section>
  );
}

function Bullets({ items }) {
  return <ul className="bullets">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

function Summary({ entry, onToggle, onCopy, onDownload, copied }) {
  const s = entry.summary;
  const has = (a) => Array.isArray(a) && a.length > 0;
  const openCount = (s.action_items || []).filter((_, i) => !entry.done[i]).length;

  return (
    <article className="summary">
      <header className="sHead">
        <div>
          <span className={`tag t-${s.detected_type}`}>{TYPE_LABEL[s.detected_type] || "Meeting"}</span>
          <h1>{s.title}</h1>
          <p className="lede">{s.summary}</p>
        </div>
        <div className="actions">
          <button className="ghost" onClick={onCopy}>{copied ? "Copied" : "Copy as Markdown"}</button>
          <button className="ghost" onClick={onDownload}>Download .md</button>
        </div>
      </header>

      <div className="grid">
        <div className="col">
          <Section title="Action items" count={has(s.action_items) ? `${openCount} open` : null}>
            {has(s.action_items) ? (
              <ul className="tasks">
                {s.action_items.map((a, i) => (
                  <li key={i} className={entry.done[i] ? "done" : ""}>
                    <label>
                      <input type="checkbox" checked={!!entry.done[i]} onChange={() => onToggle(i)} />
                      <span className="task">{a.task}</span>
                    </label>
                    <div className="meta">
                      <span className="owner">{a.owner}</span>
                      <span>{a.due}</span>
                      {a.priority && <span className={`pri p-${a.priority}`}>{a.priority}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">No action items were assigned.</p>}
          </Section>

          {has(s.standup_updates) && (
            <Section title="Updates by person">
              <div className="people">
                {s.standup_updates.map((u, i) => (
                  <div key={i} className="person">
                    <h3>{u.person}</h3>
                    {u.done && <p><b>Done</b> {u.done}</p>}
                    {u.doing && <p><b>Doing</b> {u.doing}</p>}
                    {u.blockers && <p className="blk"><b>Blocked</b> {u.blockers}</p>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {has(s.options_considered) && (
            <Section title="Options considered">
              {s.options_considered.map((o, i) => (
                <div key={i} className="option">
                  <h3>{o.option}</h3>
                  <div className="pc">
                    <ul>{(o.pros || []).map((p, j) => <li key={j} className="pro">{p}</li>)}</ul>
                    <ul>{(o.cons || []).map((c, j) => <li key={j} className="con">{c}</li>)}</ul>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {has(s.insights) && (
            <Section title="Insights">
              {s.insights.map((x, i) => (
                <div key={i} className="insight">
                  <p>{x.insight}</p>
                  {x.evidence && <p className="muted small">{x.evidence}</p>}
                </div>
              ))}
            </Section>
          )}

          {has(s.user_quotes) && (
            <Section title="In their words">
              {s.user_quotes.map((q, i) => (
                <blockquote key={i}>“{q.quote}”{q.speaker && <cite>{q.speaker}</cite>}</blockquote>
              ))}
            </Section>
          )}

          {has(s.key_points) && <Section title="Key points"><Bullets items={s.key_points} /></Section>}
        </div>

        <div className="col">
          <Section title="Decisions">
            {has(s.decisions) ? (
              <ul className="decisions">
                {s.decisions.map((d, i) => (
                  <li key={i}><p>{d.decision}</p>{d.context && <p className="muted small">{d.context}</p>}</li>
                ))}
              </ul>
            ) : <p className="muted">Nothing was firmly decided.</p>}
          </Section>

          {has(s.blockers) && <Section title="Blockers"><Bullets items={s.blockers} /></Section>}
          {has(s.risks) && <Section title="Risks"><Bullets items={s.risks} /></Section>}
          {has(s.pain_points) && <Section title="Pain points"><Bullets items={s.pain_points} /></Section>}
          {has(s.opportunities) && <Section title="Opportunities"><Bullets items={s.opportunities} /></Section>}

          <Section title="Follow-up questions">
            {has(s.follow_up_questions) ? <Bullets items={s.follow_up_questions} /> : <p className="muted">Nothing left open.</p>}
          </Section>

          {entry.transcript && (
            <details className="raw">
              <summary>Original transcript</summary>
              <pre>{entry.transcript}</pre>
            </details>
          )}
        </div>
      </div>
    </article>
  );
}
