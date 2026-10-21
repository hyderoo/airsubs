// AirSubs offscreen document.
// Owns the captured tab-audio stream, chops it into chunks, transcribes each
// chunk with Groq Whisper and translates the result (on-device Translator API
// when the pair is supported, otherwise the Groq chat model).

const GROQ_BASE = "https://api.groq.com/openai/v1";

// Whisper can hallucinate polite filler on silence or music. Skip those.
const SKIP_PATTERNS = [
  /^thank you[.! ]*$/i,
  /^thanks for watching[.! ]*$/i,
  /^thank you for watching[.! ]*$/i,
  /^terima kasih[.! ]*$/i,
  /^terima kasih (sudah|telah) menonton[.! ]*$/i,
  /^subtitles? by/i,
  /^translated by/i,
  /^\[?(music|musik|applause|tepat tangan|laughter)\]?\.?$/i,
  /^[♪\s.]+$/
];

let mediaStream = null;
let recorder = null;
let audioCtx = null;
let analyser = null;
let running = false;
let currentTabId = null;
let settings = null;
let chunkTimer = null;
let pendingChunks = 0; // if the API falls behind, drop instead of lagging
let lastOriginal = "";
let repeatCount = 0;
let recentContext = ""; // last accepted transcript, fed back as whisper's prompt

const translators = new Map(); // "src->tgt" -> Translator instance or "pending"

function status(state, detail) {
  chrome.runtime.sendMessage({ type: "OFFSCREEN_STATUS", tabId: currentTabId, state, detail }).catch(() => {});
}

async function startCapture(streamId, cfg) {
  settings = cfg;
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });
  // tabCapture reroutes the tab's audio into the stream, which silences the
  // tab for the user. Play the captured audio back so the video stays audible.
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(mediaStream);
  source.connect(audioCtx.destination);
  // and tap it for a lightweight silence check
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  running = true;
  status("listening");
  recordChunk();
}

function recordChunk() {
  if (!running || !mediaStream) return;
  let rec;
  try {
    rec = new MediaRecorder(mediaStream, { mimeType: "audio/webm;codecs=opus" });
  } catch (e) {
    rec = new MediaRecorder(mediaStream);
  }
  recorder = rec;
  let blob = null;
  startVadSampling();
  rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) blob = e.data; };
  rec.onstop = () => {
    const maxRms = stopVadSampling();
    if (blob && blob.size > 2000 && pendingChunks < 1 && maxRms >= 0.008) {
      pendingChunks += 1;
      processChunk(blob)
        .catch((e) => console.warn("chunk failed", e))
        .finally(() => { pendingChunks -= 1; });
    }
    if (running) recordChunk();
  };
  rec.start();
  chunkTimer = setTimeout(() => {
    try { if (rec.state !== "inactive") rec.stop(); } catch (_) {}
  }, (settings.chunkSec || 6) * 1000);
}

function stopCapture() {
  running = false;
  if (chunkTimer) clearTimeout(chunkTimer);
  stopVadSampling();
  try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch (_) {}
  recorder = null;
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  analyser = null;
  translators.clear();
}

let vadTimer = null;
let chunkMaxRms = 0;
function startVadSampling() {
  chunkMaxRms = 0;
  if (!analyser) return;
  const buf = new Float32Array(analyser.fftSize);
  vadTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    chunkMaxRms = Math.max(chunkMaxRms, Math.sqrt(sum / buf.length));
  }, 500);
}
function stopVadSampling() {
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  return chunkMaxRms; // ~ -42 dB threshold keeps quiet speech, drops true silence
}

function looksLikeNoise(text) {
  const t = text.trim();
  if (t.length < 2) return true;
  return SKIP_PATTERNS.some((re) => re.test(t));
}

async function processChunk(blob) {
  const t0 = Date.now();
  let result;
  try {
    result = await transcribe(blob);
  } catch (e) {
    handleApiError(e, "transcription");
    return;
  }
  const original = (result.text || "").trim();
  const lang = result.language || settings.sourceLang || "auto";
  if (!original || looksLikeNoise(original)) return;
  recentContext = (recentContext + " " + original).slice(-400);

  // drop stutter: whisper sometimes repeats the previous line verbatim
  if (original === lastOriginal) {
    repeatCount += 1;
    if (repeatCount >= 1) return;
  } else {
    repeatCount = 0;
    lastOriginal = original;
  }

  let translated = "";
  if (settings.targetLang && settings.targetLang !== "none" && lang !== settings.targetLang) {
    try {
      translated = await translate(original, lang);
    } catch (e) {
      handleApiError(e, "translation");
    }
  }
  chrome.runtime.sendMessage({
    type: "CAPTION",
    tabId: currentTabId,
    original,
    translated,
    lang,
    latencyMs: Date.now() - t0
  }).catch(() => {});
}

async function transcribe(blob) {
  const form = new FormData();
  form.append("file", blob, "chunk.webm");
  form.append("model", settings.sttModel || "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  if (settings.sourceLang && settings.sourceLang !== "auto") form.append("language", settings.sourceLang);
  if (recentContext) form.append("prompt", recentContext.slice(-220));
  form.append("temperature", "0");
  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: form
  });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

async function translate(text, detectedLang) {
  const src = settings.sourceLang && settings.sourceLang !== "auto" ? settings.sourceLang : detectedLang;
  const tgt = settings.targetLang;

  if (settings.preferOnDevice !== false && "Translator" in self) {
    try {
      const onDevice = await translateOnDevice(text, src, tgt);
      if (onDevice) return onDevice;
    } catch (e) {
      console.warn("on-device translation failed, falling back to API", e);
    }
  }

  const srcName = AIRSUBS_LANGUAGES[src] || src;
  const tgtName = AIRSUBS_LANGUAGES[tgt] || tgt;
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.chatModel || "openai/gpt-oss-120b",
      temperature: 0.2,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You translate live subtitles from ${srcName} to ${tgtName}. Reply with the translation only: no quotes, no notes, no alternatives. Keep it natural and short, the way subtitles read.`
        },
        { role: "user", content: text }
      ]
    })
  });
  if (!res.ok) throw await apiError(res);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function translateOnDevice(text, src, tgt) {
  if (!src || src === "auto") return null;
  const key = `${src}->${tgt}`;
  let translator = translators.get(key);
  if (!translator) {
    translators.set(key, "pending");
    const availability = await Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
    if (availability === "unavailable") {
      translators.delete(key);
      return null;
    }
    translator = await Translator.create({ sourceLanguage: src, targetLanguage: tgt });
    translators.set(key, translator);
  }
  if (translator === "pending") return null;
  return translator.translate(text);
}

async function apiError(res) {
  let body = "";
  try { body = await res.text(); } catch (_) {}
  const err = new Error(`Groq ${res.status}: ${body.slice(0, 300)}`);
  err.status = res.status;
  err.retryAfter = res.headers.get("retry-after");
  return err;
}

function handleApiError(e, phase) {
  if (e.status === 401 || e.status === 403) {
    status("error", "API key rejected. Open Settings and check the key.");
    running = false;
    stopCapture();
  } else if (e.status === 429) {
    const perDay = /per day|rpd|requests per day|tokens per day/i.test(String(e.message));
    status("rate_limited", perDay
      ? `Daily free quota hit during ${phase}. It resets at midnight UTC.`
      : `Rate limit during ${phase}, backing off ${e.retryAfter || 30}s.`);
    if (perDay) {
      running = false;
      stopCapture();
    }
  } else {
    status("error", `${phase} failed: ${e.message}`);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "OFFSCREEN_START") {
    currentTabId = msg.tabId;
    stopCapture();
    startCapture(msg.streamId, msg.settings).catch((e) => {
      status("error", "Could not capture tab audio: " + e.message);
    });
  } else if (msg.type === "OFFSCREEN_STOP") {
    stopCapture();
    status("stopped");
  }
});
