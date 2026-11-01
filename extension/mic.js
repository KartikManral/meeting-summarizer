const out = document.getElementById("out");
navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((s) => {
    s.getTracks().forEach((t) => t.stop());
    out.textContent = "Done. Your microphone is allowed. You can close this tab.";
    out.className = "note ok";
    chrome.storage.local.get("settings").then(({ settings = {} }) =>
      chrome.storage.local.set({ settings: { ...settings, withMic: true } })
    );
  })
  .catch(() => {
    out.textContent =
      "Microphone was blocked. Click the icon at the left of the address bar, allow Microphone, then reload this tab.";
    out.className = "note bad";
  });
