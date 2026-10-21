const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  sourceLang: "auto",
  targetLang: "id",
  showOriginal: true,
  chunkSec: 6,
  sttModel: "whisper-large-v3-turbo",
  chatModel: "openai/gpt-oss-120b",
  preferOnDevice: true,
  apiKey: ""
};

let activeTabId = null;
let settings = { ...DEFAULTS };

function fillLanguages() {
  const src = $("sourceLang");
  const tgt = $("targetLang");
  for (const [code, name] of Object.entries(AIRSUBS_LANGUAGES)) {
    src.append(new Option(name, code));
    if (code !== "auto") tgt.append(new Option(name, code));
  }
  tgt.append(new Option("No translation, transcript only", "none"));
}

async function load() {
  fillLanguages();
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  settings = { ...DEFAULTS, ...stored };
  $("sourceLang").value = settings.sourceLang;
  $("targetLang").value = settings.targetLang;
  $("showOriginal").checked = settings.showOriginal;
  $("keyWarning").hidden = !!settings.apiKey;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE", tabId: activeTabId });
  renderState(state?.state || "idle", state?.detail || "");
}

function renderState(state, detail) {
  const dot = $("statusDot");
  const text = $("statusText");
  dot.className = "dot";
  $("startBtn").hidden = state === "listening" || state === "starting";
  $("stopBtn").hidden = !$("startBtn").hidden;
  if (state === "listening") { dot.classList.add("on"); text.textContent = "Listening — captions are on for this tab."; }
  else if (state === "starting") { dot.classList.add("warn"); text.textContent = "Starting…"; }
  else if (state === "rate_limited") { dot.classList.add("warn"); text.textContent = detail || "Rate limited."; }
  else if (state === "error") { dot.classList.add("err"); text.textContent = detail || "Something went wrong."; }
  else { text.textContent = "Captions are off for this tab."; }
}

$("startBtn").addEventListener("click", async () => {
  settings.sourceLang = $("sourceLang").value;
  settings.targetLang = $("targetLang").value;
  settings.showOriginal = $("showOriginal").checked;
  await chrome.storage.local.set({
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang,
    showOriginal: settings.showOriginal
  });
  if (!settings.apiKey) { $("keyWarning").hidden = false; return; }

  const btn = $("startBtn");
  btn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: "INJECT_OVERLAY", tabId: activeTabId });
    await chrome.tabs.sendMessage(activeTabId, { type: "OVERLAY_PREPARE", showOriginal: settings.showOriginal }).catch(() => {});
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId });
    await chrome.runtime.sendMessage({ type: "POPUP_START", tabId: activeTabId, streamId, settings });
    renderState("starting");
  } catch (e) {
    renderState("error", "Could not start: " + (e?.message || e));
  } finally {
    btn.disabled = false;
  }
});

$("stopBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "POPUP_STOP", tabId: activeTabId });
  chrome.tabs.sendMessage(activeTabId, { type: "OVERLAY_IDLE" }).catch(() => {});
  renderState("idle");
});

$("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("openOptionsLink").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATE_CHANGED" && msg.tabId === activeTabId) {
    renderState(msg.state, msg.detail);
  }
});

load();
