// AirSubs background service worker.
// Coordinates the popup, the offscreen audio document and the content overlay.

const sessions = new Map(); // tabId -> { state, detail, updatedAt }

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (!has) {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Capture tab audio for live transcription and translation, and play it back so the tab stays audible while captioning."
    });
  }
}

async function closeOffscreenIfIdle() {
  const has = await chrome.offscreen.hasDocument();
  if (has) await chrome.offscreen.closeDocument();
}

function setState(tabId, state, detail) {
  sessions.set(tabId, { state, detail: detail || "", updatedAt: Date.now() });
  // keep the popup's status fresh if it is open
  chrome.runtime.sendMessage({ type: "STATE_CHANGED", tabId, state, detail }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "POPUP_START") {
      const { tabId, streamId, settings } = msg;
      await ensureOffscreen();
      setState(tabId, "starting");
      // give the offscreen document a tick to register its listener
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: "OFFSCREEN_START", streamId, tabId, settings }).catch(() => {});
      }, 250);
      sendResponse({ ok: true });
    } else if (msg.type === "POPUP_STOP") {
      const { tabId } = msg;
      chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP", tabId }).catch(() => {});
      setState(tabId, "idle");
      sendResponse({ ok: true });
    } else if (msg.type === "GET_STATE") {
      const s = sessions.get(msg.tabId);
      sendResponse(s || { state: "idle", detail: "" });
    } else if (msg.type === "OFFSCREEN_STATUS") {
      setState(msg.tabId, msg.state, msg.detail);
      if (msg.state === "stopped" || msg.state === "error") {
        // relay to the page so the overlay can say goodbye / show the error
        chrome.tabs.sendMessage(msg.tabId, { type: "CAPTION_STATUS", state: msg.state, detail: msg.detail }).catch(() => {});
        if (msg.state === "stopped") setTimeout(closeOffscreenIfIdle, 500);
      }
      sendResponse({ ok: true });
    } else if (msg.type === "CAPTION") {
      chrome.tabs.sendMessage(msg.tabId, {
        type: "CAPTION_SHOW",
        original: msg.original,
        translated: msg.translated,
        lang: msg.lang,
        latencyMs: msg.latencyMs
      }).catch(() => {});
      sendResponse({ ok: true });
    } else if (msg.type === "INJECT_OVERLAY") {
      await chrome.scripting.executeScript({
        target: { tabId: msg.tabId },
        files: ["src/content/overlay.js"]
      });
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err) });
  });
  return true; // async response
});
