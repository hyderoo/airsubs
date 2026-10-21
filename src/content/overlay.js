// AirSubs caption overlay, Netflix-style: plain outlined text floating over
// the video, no panel. Anchors to the largest visible <video>, follows it
// into fullscreen, controls appear only on hover.
(() => {
  if (window.__airsubsOverlay) {
    window.__airsubsOverlay.wake();
    return;
  }

  const host = document.createElement("div");
  host.id = "airsubs-host";
  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap {
        position: fixed; left: 50%; top: 90vh; transform: translate(-50%, -100%);
        z-index: 2147483647; width: max-content; max-width: 80vw;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        text-align: center; pointer-events: none;
      }
      .lines { pointer-events: auto; cursor: default; display: inline-block; max-width: 100%; }
      .trans, .orig {
        display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden;
        color: #fff; margin: 0 auto;
        text-shadow:
          -1px -1px 0 rgba(0,0,0,.9), 1px -1px 0 rgba(0,0,0,.9),
          -1px  1px 0 rgba(0,0,0,.9), 1px  1px 0 rgba(0,0,0,.9),
          0 0 8px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.55);
        transition: opacity .12s ease, transform .12s ease;
      }
      .trans {
        font-size: var(--fs, 24px); font-weight: 700; line-height: 1.32;
        letter-spacing: .1px; -webkit-line-clamp: 2;
      }
      .orig {
        font-size: calc(var(--fs, 24px) * 0.58); font-weight: 500; line-height: 1.35;
        color: rgba(255,255,255,.78); margin-top: 4px; -webkit-line-clamp: 1;
      }
      .orig.hidden { display: none; }
      .with-bg .trans, .with-bg .orig {
        background: rgba(0,0,0,.62); padding: 1px 8px; border-radius: 4px;
        -webkit-box-decoration-break: clone; box-decoration-break: clone;
        text-shadow: none;
      }
      .swap .trans, .swap .orig { opacity: 0; transform: translateY(5px); }
      .notice {
        display: none; margin-top: 6px; font-size: 12.5px; color: #ffd37a;
        text-shadow: 0 1px 3px rgba(0,0,0,.8);
      }
      .bar {
        position: absolute; left: 50%; bottom: 100%; transform: translate(-50%, -4px);
        display: flex; align-items: center; gap: 1px; padding: 3px 5px;
        background: rgba(20, 22, 26, 0.78); border: 1px solid rgba(255,255,255,.1);
        -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
        border-radius: 9px; opacity: 0; pointer-events: none;
        transition: opacity .15s ease; white-space: nowrap;
      }
      .wrap:hover .bar, .bar.pin { opacity: 1; pointer-events: auto; }
      .grip {
        cursor: grab; color: rgba(255,255,255,.45); padding: 2px 5px;
        font-size: 11px; letter-spacing: 2px; user-select: none; touch-action: none;
      }
      .grip:active { cursor: grabbing; }
      .btn {
        appearance: none; background: none; border: 0; cursor: pointer;
        color: rgba(255,255,255,.6); width: 24px; height: 24px; border-radius: 6px;
        display: inline-flex; align-items: center; justify-content: center; padding: 0;
      }
      .btn:hover { background: rgba(255,255,255,.12); color: #fff; }
      .btn svg { width: 14px; height: 14px; }
      .btn.active { color: #8ec5ff; }
      .sep { width: 1px; height: 14px; background: rgba(255,255,255,.12); margin: 0 2px; }
    </style>
    <div class="wrap">
      <div class="bar">
        <span class="grip" title="Drag to move, double-click to snap back">⠿</span>
        <span class="sep"></span>
        <button class="btn" id="origToggle" title="Show/hide original line">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h10M4 17h7"/></svg>
        </button>
        <button class="btn" id="smaller" title="Smaller text"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg></button>
        <button class="btn" id="bigger" title="Bigger text"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></button>
        <button class="btn" id="save" title="Download transcript (.srt)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/></svg>
        </button>
        <button class="btn" id="close" title="Hide">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="lines">
        <div class="trans"></div>
        <div class="orig"></div>
        <div class="notice"></div>
      </div>
    </div>`;

  document.documentElement.appendChild(host);

  const wrap = shadow.querySelector(".wrap");
  const lines = shadow.querySelector(".lines");
  const transEl = shadow.querySelector(".trans");
  const origEl = shadow.querySelector(".orig");
  const noticeEl = shadow.querySelector(".notice");
  const grip = shadow.querySelector(".grip");

  const transcript = [];
  let lastLine = null;
  let scale = 1;
  let showOriginal = true;
  let manualPos = null; // {left, top} once the user drags

  function applyBg(on) { lines.classList.toggle("with-bg", !!on); }
  try {
    chrome.storage.local.get(["fontScale", "captionBg"]).then((s) => {
      if (s.fontScale) scale = Math.min(1.8, Math.max(0.6, s.fontScale));
      applyBg(!!s.captionBg);
      anchor();
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.fontScale) { scale = Math.min(1.8, Math.max(0.6, changes.fontScale.newValue || 1)); anchor(); }
      if (changes.captionBg) applyBg(changes.captionBg.newValue);
    });
  } catch (_) {}

  function persistScale() {
    try { chrome.storage.local.set({ fontScale: scale }); } catch (_) {}
  }

  // ---- video anchoring ----
  function findVideo() {
    const scope = document.fullscreenElement || document;
    const videos = [...scope.querySelectorAll("video")].filter((v) => {
      const r = v.getBoundingClientRect();
      return r.width > 120 && r.height > 90;
    });
    if (!videos.length) return null;
    videos.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return videos[0];
  }

  function anchor() {
    if (manualPos) {
      wrap.style.left = manualPos.left;
      wrap.style.top = manualPos.top;
      return;
    }
    const v = findVideo();
    let rect;
    if (v) rect = v.getBoundingClientRect();
    else rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, bottom: window.innerHeight };
    wrap.style.left = rect.left + rect.width / 2 + "px";
    wrap.style.top = rect.bottom - Math.max(rect.height * 0.07, 28) + "px";
    wrap.style.maxWidth = Math.min(rect.width * 0.86, window.innerWidth * 0.8) + "px";
    // Netflix-like scale: caption size tracks the player size
    const fs = Math.min(28, Math.max(13, rect.height * 0.027)) * scale;
    wrap.style.setProperty("--fs", fs.toFixed(1) + "px");
  }

  // keep the host inside the fullscreen element, otherwise the top layer hides it
  function syncFullscreenParent() {
    const fsEl = document.fullscreenElement;
    const target = fsEl || document.documentElement;
    if (host.parentElement !== target) target.appendChild(host);
  }

  window.addEventListener("resize", anchor, { passive: true });
  window.addEventListener("scroll", anchor, { passive: true });
  document.addEventListener("fullscreenchange", () => { syncFullscreenParent(); anchor(); });
  setInterval(() => { syncFullscreenParent(); anchor(); }, 800);

  // ---- captions ----
  function setLine(original, translated) {
    const now = Date.now();
    if (lastLine) lastLine.end = now;
    lines.classList.add("swap");
    setTimeout(() => {
      const main = translated || original;
      transEl.textContent = main;
      origEl.textContent = translated && translated !== original ? original : "";
      origEl.classList.toggle("hidden", !showOriginal || !origEl.textContent);
      lines.classList.remove("swap");
    }, 120);
    lastLine = { start: now, end: now, original, translated: translated || "" };
    transcript.push(lastLine);
    noticeEl.style.display = "none";
  }

  function setNotice(text) {
    noticeEl.textContent = text;
    noticeEl.style.display = text ? "block" : "none";
  }

  // ---- drag (manual until double-click on the grip) ----
  let dragging = false, dragX = 0, dragY = 0;
  grip.addEventListener("pointerdown", (e) => {
    dragging = true;
    const r = wrap.getBoundingClientRect();
    dragX = e.clientX - r.left;
    dragY = e.clientY - r.top;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    manualPos = {
      left: Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragX)) + "px",
      top: Math.max(0, Math.min(window.innerHeight - 30, e.clientY - dragY)) + "px"
    };
    wrap.style.left = manualPos.left;
    wrap.style.top = manualPos.top;
    wrap.style.transform = "none";
  });
  grip.addEventListener("pointerup", () => { dragging = false; });
  grip.addEventListener("dblclick", () => {
    manualPos = null;
    wrap.style.transform = "translate(-50%, -100%)";
    anchor();
  });

  // ---- toolbar ----
  shadow.getElementById("origToggle").addEventListener("click", () => {
    showOriginal = !showOriginal;
    origEl.classList.toggle("hidden", !showOriginal || !origEl.textContent);
    shadow.getElementById("origToggle").classList.toggle("active", showOriginal);
  });
  shadow.getElementById("bigger").addEventListener("click", () => { scale = Math.min(1.8, scale + 0.15); anchor(); persistScale(); });
  shadow.getElementById("smaller").addEventListener("click", () => { scale = Math.max(0.6, scale - 0.15); anchor(); persistScale(); });
  shadow.getElementById("close").addEventListener("click", () => { host.style.display = "none"; });
  shadow.getElementById("save").addEventListener("click", () => {
    if (!transcript.length) return;
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    const ts = (ms) => `${pad(ms / 3600000 | 0)}:${pad((ms / 60000 | 0) % 60)}:${pad((ms / 1000 | 0) % 60)},${pad(ms % 1000, 3)}`;
    const t0 = transcript[0].start;
    const srt = transcript.map((l, i) =>
      `${i + 1}\n${ts(l.start - t0)} --> ${ts(Math.max(l.end, l.start + 1200) - t0)}\n${l.translated || l.original}${l.translated && l.original ? "\n" + l.original : ""}\n`
    ).join("\n");
    const blob = new Blob([srt], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `airsubs-transcript-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.srt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CAPTION_SHOW") {
      host.style.display = "";
      setLine(msg.original || "", msg.translated || "");
    } else if (msg.type === "CAPTION_STATUS") {
      if (msg.state === "error" || msg.state === "rate_limited") setNotice(msg.detail || msg.state);
      else if (msg.state === "stopped") { transEl.textContent = ""; origEl.textContent = ""; setNotice("Captions stopped."); }
    } else if (msg.type === "OVERLAY_PREPARE") {
      host.style.display = "";
      showOriginal = msg.showOriginal !== false;
      shadow.getElementById("origToggle").classList.toggle("active", showOriginal);
      transEl.textContent = "";
      origEl.textContent = "";
      setNotice("Listening…");
      anchor();
    } else if (msg.type === "OVERLAY_IDLE") {
      setNotice("Captions are off.");
    }
  });

  anchor();

  window.__airsubsOverlay = {
    wake() { host.style.display = ""; anchor(); }
  };
})();
