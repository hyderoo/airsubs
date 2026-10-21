const $ = (id) => document.getElementById(id);
const KEYS = ["apiKey", "sttModel", "chatModel", "preferOnDevice", "chunkSec", "fontScale", "captionBg"];

async function load() {
  const s = await chrome.storage.local.get(KEYS);
  $("apiKey").value = s.apiKey || "";
  $("sttModel").value = s.sttModel || "whisper-large-v3-turbo";
  $("chatModel").value = s.chatModel || "openai/gpt-oss-120b";
  $("preferOnDevice").checked = s.preferOnDevice !== false;
  $("chunkSec").value = s.chunkSec || 6;
  $("chunkVal").textContent = $("chunkSec").value;
  $("fontScale").value = Math.round((s.fontScale || 1) * 100);
  $("scaleVal").textContent = $("fontScale").value;
  $("captionBg").checked = !!s.captionBg;
}

async function save() {
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    sttModel: $("sttModel").value,
    chatModel: $("chatModel").value,
    preferOnDevice: $("preferOnDevice").checked,
    chunkSec: Number($("chunkSec").value),
    fontScale: Number($("fontScale").value) / 100,
    captionBg: $("captionBg").checked
  });
  $("saved").hidden = false;
  setTimeout(() => { $("saved").hidden = true; }, 1500);
}

$("saveKey").addEventListener("click", save);
for (const id of ["sttModel", "chatModel", "preferOnDevice", "chunkSec", "captionBg"]) {
  $(id).addEventListener("change", save);
}
$("chunkSec").addEventListener("input", () => { $("chunkVal").textContent = $("chunkSec").value; });
$("fontScale").addEventListener("input", () => { $("scaleVal").textContent = $("fontScale").value; });
$("fontScale").addEventListener("change", save);

$("testKey").addEventListener("click", async () => {
  const el = $("keyStatus");
  el.className = "hint"; el.textContent = "Checking…";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${$("apiKey").value.trim()}` }
    });
    if (res.ok) { el.classList.add("ok"); el.textContent = "Key works."; }
    else { el.classList.add("bad"); el.textContent = `Rejected (HTTP ${res.status}). Check the key.`; }
  } catch (e) {
    el.classList.add("bad"); el.textContent = "Network error: " + e.message;
  }
});

load();
