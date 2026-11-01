// Opens the side panel when the toolbar icon is clicked, runs the offscreen recorder,
// and keeps the live transcript in storage so the panel can be closed and reopened.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "start": {
        await ensureOffscreen();
        await setState({ status: "starting", error: "", startedAt: Date.now(), tabTitle: msg.tabTitle || "" });
        chrome.runtime.sendMessage({ target: "offscreen", type: "start", ...msg.payload });
        sendResponse({ ok: true });
        break;
      }
      case "stop": {
        chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
        sendResponse({ ok: true });
        break;
      }
      // Messages from the offscreen recorder
      case "rec-status": {
        await setState({ status: msg.status, error: msg.error || "" });
        if (msg.status === "stopped") setTimeout(closeOffscreen, 500);
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
  return msg.type === "start" || msg.type === "stop";
});
