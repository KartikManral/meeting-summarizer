// Clicking the toolbar icon on a tab opens the side panel AND starts listening to that tab.
// (Chrome only allows tab audio capture straight from an icon click, not from a button in the panel.)
// The offscreen recorder runs the capture; the transcript is kept in storage so the panel can be reopened.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

const OFFSCREEN = "offscreen.html";

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
  });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ["USER_MEDIA"],
    justification: "Record the meeting tab's audio to transcribe it live.",
  });
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {}
}

async function setState(patch) {
  const { live = {} } = await chrome.storage.local.get("live");
  await chrome.storage.local.set({ live: { ...live, ...patch } });
}

chrome.action.onClicked.addListener((tab) => {
  // Must be the first call, while Chrome still counts this as your click.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  startOnTab(tab);
});

async function startOnTab(tab) {
  const { live = {}, settings = {} } = await chrome.storage.local.get(["live", "settings"]);
  if (live.status === "listening" || live.status === "starting") {
    // Already running: just show the panel. (Unless Chrome restarted and the recorder is gone.)
    const rec = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (rec.length) return;
  }

  if (!settings.name || !settings.appUrl) {
    await setState({ status: "idle", error: "Fill in settings and Save, then click the Minutes icon on your meeting tab again." });
    return;
  }
  if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    await setState({ status: "idle", error: "Open your meeting tab, then click the Minutes icon while you're on it." });
    return;
  }

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (e) {
    await setState({ status: "idle", error: "Chrome wouldn't let me capture this tab: " + e.message });
    return;
  }

  await chrome.storage.local.set({ lines: [] });
  await ensureOffscreen();
  await setState({ status: "starting", error: "", lastChunkError: "", startedAt: Date.now(), tabTitle: tab.title || "" });
  chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start",
    streamId,
    withMic: settings.withMic,
    appUrl: settings.appUrl,
    password: settings.password,
    name: settings.name,
    aliases: settings.aliases,
    language: settings.language || "auto",
  });
}

// Keep the last 20 meetings so you can get their summary later.
async function archiveMeeting() {
  await new Promise((r) => setTimeout(r, 400)); // let the last line finish saving
  const { lines = [], live = {}, meetings = [] } = await chrome.storage.local.get(["lines", "live", "meetings"]);
  if (!lines.length || !live.startedAt) return;
  if (meetings.some((m) => m.startedAt === live.startedAt)) return;
  meetings.unshift({
    id: String(live.startedAt),
    title: live.tabTitle || "Meeting",
    startedAt: live.startedAt,
    endedAt: Date.now(),
    lines,
  });
  await chrome.storage.local.set({ meetings: meetings.slice(0, 20) });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "stop": {
        chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
        // If the recorder is already gone, make sure the panel doesn't stay stuck on "listening".
        setTimeout(async () => {
          const ctx = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
          if (!ctx.length) await setState({ status: "stopped" });
        }, 1500);
        sendResponse({ ok: true });
        break;
      }
      // Messages from the offscreen recorder
      case "rec-status": {
        await setState({ status: msg.status, error: msg.error || "" });
        if (msg.status === "stopped") {
          await archiveMeeting();
          setTimeout(closeOffscreen, 500);
        }
        break;
      }
      case "rec-text": {
        const { lines = [] } = await chrome.storage.local.get("lines");
        lines.push({ t: msg.t, text: msg.text });
        await chrome.storage.local.set({ lines });
        break;
      }
      case "rec-error": {
        await setState({ lastChunkError: msg.error });
        break;
      }
    }
  })();
  return msg.type === "stop";
});
