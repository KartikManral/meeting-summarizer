# Minutes: AI meeting summarizer

Paste a meeting transcript (or drop a recording) and get back:

- **Action items** with owner, due date and priority (tick them off as you go)
- **Decisions made**, with the reasoning
- **Follow-up questions** that were left open
- Extra sections depending on the meeting type:
  - **Standup**: updates per person (done / doing / blocked) and a blockers list
  - **Strategy / planning**: options considered with pros and cons, plus risks
  - **User research**: insights with evidence, pain points, opportunities, and real quotes
  - **Auto-detect**: it works out the type itself

It also reads Zoom / Google Meet / Teams caption files (`.vtt`, `.srt`), keeps your recent summaries in your browser, and exports any summary as Markdown (works when pasted into Notion).

---

## What you need

**Everything can run for free.** Two free keys, no credit card:

| Key | What it does | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | Writes the summaries (handles long meetings) | aistudio.google.com/apikey → Create API key |
| `GROQ_API_KEY` | Transcribes audio files | console.groq.com/keys → Create API key |
| `APP_PASSWORD` | Stops strangers using your free limits once it's online | Any password you choose |

**Even simpler:** set only `GROQ_API_KEY` and it does both audio and summaries. The catch is that Groq's free limit only fits meetings up to about 20 minutes of talk. If a meeting is too long, the app tells you so.

**Free-tier limits:** Gemini's free tier allows a limited number of requests per day. That's plenty for your own meetings, but heavy sharing can hit it (the app then asks you to wait). Google may use free-tier inputs to improve its products, so don't paste confidential company meetings on the free key.

**Optional paid upgrade:** add `ANTHROPIC_API_KEY` (console.anthropic.com) and Claude writes the summaries instead. It's the most accurate option and costs a few cents per meeting. You don't need to change any code; the app uses it automatically when the key is present.

---

## Run it on your computer (PowerShell)

1. Unzip this folder into `C:\Users\HP\projects\meeting-summarizer`
2. Open PowerShell and run:

```powershell
cd C:\Users\HP\projects\meeting-summarizer
copy .env.example .env.local
notepad .env.local
```

3. In Notepad, paste your real keys in place of `your_anthropic_key` etc. Save and close.
4. Back in PowerShell:

```powershell
npm install
npm run dev
```

5. Open http://localhost:3000. Try it with `sample-transcript.txt` (click **Upload file**).

To stop it, press `Ctrl + C` in PowerShell.

---

## Put it online (GitHub + Vercel)

```powershell
cd C:\Users\HP\projects\meeting-summarizer
git init
git add .
git commit -m "Meeting summarizer"
```

Create an empty repo on GitHub called `meeting-summarizer`, then:

```powershell
git remote add origin https://github.com/KartikManral/meeting-summarizer.git
git branch -M main
git push -u origin main
```

Then on vercel.com: **Add New → Project → import `meeting-summarizer`**. Before clicking Deploy, open **Environment Variables** and add `GEMINI_API_KEY`, `GROQ_API_KEY` and `APP_PASSWORD` (plus `ANTHROPIC_API_KEY` only if you're paying for Claude). Then **Deploy**.

`.env.local` is never uploaded to GitHub (it's in `.gitignore`), so your keys stay private.

If you change the keys later in Vercel, go to **Deployments → ⋯ → Redeploy** for them to take effect.

### Sharing it with someone

Send them the link and the app password. They type the password into the box at the bottom-left once. Their summaries are saved in their own browser, not yours. They share your free daily limit, so only give the password to a few people.

---

## Good to know

- **Audio:** files under 4 MB go straight to transcription. Bigger files are split into ~100-second pieces in your browser first (Vercel can't accept large uploads), so a 1-hour recording takes a minute or two. Very long recordings (2+ hours) can be slow on older laptops; for those, a transcript from Zoom/Meet/Otter is faster.
- **Speaker names:** audio transcription doesn't know who said what. Put names in the "Optional context" box (e.g. "Priya runs payments, Rohan does analytics") and the summary will assign owners much better. Caption files from Zoom/Meet/Teams already include names.
- **Accuracy:** the AI is told never to invent owners or dates. If nobody was assigned, it says "Unassigned" / "No date".
- **Changing the AI model:** set `CLAUDE_MODEL` in your environment variables.

## Where things are (if you want to tweak)

- `lib/prompts.js`: the instructions for each meeting type and the fields the summary has. Adding a new meeting type starts here.
- `app/page.js`: the page you see.
- `app/globals.css`: colors and layout. The color palette is at the top.
- `app/api/summarize/route.js`: sends the transcript to Claude.
- `app/api/transcribe/route.js`: sends audio to Groq Whisper.

---

## Minutes Live: the Chrome extension

A side panel that listens to your meeting tab with you:

- **Live transcript**, a new line about every 10 seconds
- **🔔 Automatic alert** when your name comes up: what you were asked, who asked it, and a reply you could say
- **🙋 What was I asked?** if you zoned out and nobody said your name
- **⏪ What did I miss?** for the last few minutes in bullets
- **Ask box**, e.g. "what deadline did they agree on?"
- **Full summary ↗** sends the whole transcript to your Minutes app

It uses your deployed Minutes app (same free keys), so deploy the app first.

### Install (one time)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and choose the `extension` folder inside this project.
4. Pin it: click the puzzle icon in Chrome's toolbar, then the pin next to **Minutes Live**.

### Use it in a meeting

1. Join your meeting in Chrome (Google Meet, or Zoom/Teams in the browser).
2. **On the meeting tab**, click the Minutes icon in the toolbar. The side panel opens and it starts listening.
   (First time only: fill in settings with your app link, password and name, click Save, then click the icon again.)
3. Click **Stop listening** in the panel when the meeting ends.

Chrome only lets extensions capture a tab's audio when you click the extension's own icon on that tab, so starting happens from the icon rather than a button in the panel.

Your own voice isn't part of the tab's audio. To include it, tick **Also record my microphone** and click **Allow microphone** once.

### Good to know

- Tell people you're taking AI notes. Recording others without telling them can break workplace, college or legal rules.
- Lines arrive ~10 seconds behind the conversation.
- The transcript has no speaker names. Adding nicknames people use for you (e.g. "KM") helps the alert trigger.
- Free limits: Groq's free tier comfortably covers a few hours of meetings a day.
- After editing extension files, click the ↻ reload icon on the extension's card in `chrome://extensions`.
