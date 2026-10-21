// LiveSub on-page caption overlay. Injected on demand; renders into a shadow
// root so the host page's styles cannot leak in.
(() => {
  if (window.__livesubOverlay) {
    window.__livesubOverlay.wake();
    return;
  }

  const POS_KEY = "overlayPos:" + location.origin;

  const host = document.createElement("div");
  host.id = "livesub-host";
  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap {
        position: fixed; left: 50%; bottom: 9vh; transform: translateX(-50%);
        z-index: 2147483647; width: max-content; max-width: min(760px, 86vw);
        font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      .box {
        background: rgba(16, 17, 20, 0.82);
        -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 14px; padding: 10px 16px 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
      }
      .bar {
        display: flex; align-items: center; gap: 2px; margin: -4px -8px 6px;
        padding: 2px 4px 4px; border-bottom: 1px solid rgba(255,255,255,0.07);
      }
      .grip {
        cursor: grab; color: rgba(255,255,255,0.4); padding: 4px 6px; flex: 0 0 auto;
        user-select: none; font-size: 12px; letter-spacing: 2px; touch-action: none;
      }
      .grip:active { cursor: grabbing; }
      .spacer { flex: 1; }
      .btn {
        appearance: none; background: none; border: 0; cursor: pointer;
        color: rgba(255,255,255,0.55); width: 26px; height: 26px; border-radius: 7px;
        display: inline-flex; align-items: center; justify-content: center; padding: 0;
      }
      .btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
      .btn svg { width: 15px; height: 15px; }
      .btn.active { color: #8ec5ff; }
      .lines { text-align: center; }
      .trans {
        color: #fff; font-size: 19px; font-weight: 600; line-height: 1.35;
        text-shadow: 0 1px 3px rgba(0,0,0,0.6);
      }
      .orig {
        color: rgba(255,255,255,0.62); font-size: 13.5px; line-height: 1.4; margin-top: 3px;
      }
      .orig.hidden { display: none; }
      .notice {
        color: #ffd37a; font-size: 12.5px; text-align: center; margin-top: 6px; display: none;
      }
      .empty { color: rgba(255,255,255,0.45); font-size: 13px; text-align: center; }
    </style>
    <div class="wrap">
      <div class="box">
        <div class="bar">
          <span class="grip" title="Drag to move">⠿</span>
          <span class="spacer"></span>
          <button class="btn" id="origToggle" title="Show/hide original line">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h10M4 17h7"/></svg>
          </button>
          <button class="btn" id="smaller" title="Smaller text"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg></button>
          <button class="btn" id="bigger" title="Bigger text"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></button>
          <button class="btn" id="save" title="Download transcript (.srt)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/></svg>
          </button>
          <button class="btn" id="close" title="Hide overlay">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="lines">
          <div class="trans empty">Listening…</div>
          <div class="orig"></div>
          <div class="notice"></div>
        </div>
      </div>
    </div>`;

  document.documentElement.appendChild(host);

  const wrap = shadow.querySelector(".wrap");
  const transEl = shadow.querySelector(".trans");
  const origEl = shadow.querySelector(".orig");
  const noticeEl = shadow.querySelector(".notice");
  const grip = shadow.querySelector(".grip");

  const transcript = []; // {start, end, original, translated}
  let lastLine = null;
  let scale = 1;
  let showOriginal = true;

  function setLine(original, translated) {
    const now = Date.now();
    if (lastLine) lastLine.end = now;
    const main = translated || original;
    transEl.textContent = main;
    transEl.classList.remove("empty");
    origEl.textContent = translated && translated !== original ? original : "";
    origEl.classList.toggle("hidden", !showOriginal || !origEl.textContent);
    lastLine = { start: now, end: now, original, translated: translated || "" };
    transcript.push(lastLine);
    noticeEl.style.display = "none";
  }

  function setNotice(text) {
    noticeEl.textContent = text;
    noticeEl.style.display = text ? "block" : "none";
  }

  function applyScale() {
    transEl.style.fontSize = (19 * scale).toFixed(1) + "px";
    origEl.style.fontSize = (13.5 * scale).toFixed(1) + "px";
  }

  // --- drag ---
  let dragging = false, dragX = 0, dragY = 0;
  grip.addEventListener("pointerdown", (e) => {
    dragging = true;
    const r = wrap.getBoundingClientRect();
    dragX = e.clientX - r.left;
    dragY = e.clientY - r.top;
    grip.setPointerCapture(e.pointerId);
    wrap.style.transform = "none";
    wrap.style.left = r.left + "px";
    wrap.style.top = r.top + "px";
    wrap.style.bottom = "auto";
  });
  grip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    wrap.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dragX)) + "px";
    wrap.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragY)) + "px";
  });
  grip.addEventListener("pointerup", () => {
    dragging = false;
    try {
      chrome.storage.local.set({ [POS_KEY]: { left: wrap.style.left, top: wrap.style.top } });
    } catch (_) {}
  });

  async function restorePos() {
    try {
      const s = await chrome.storage.local.get(POS_KEY);
      const p = s[POS_KEY];
      if (p) {
        wrap.style.transform = "none";
        wrap.style.left = p.left;
        wrap.style.top = p.top;
        wrap.style.bottom = "auto";
      }
    } catch (_) {}
  }
  restorePos();

  // --- toolbar ---
  shadow.getElementById("origToggle").addEventListener("click", () => {
    showOriginal = !showOriginal;
    origEl.classList.toggle("hidden", !showOriginal || !origEl.textContent);
    shadow.getElementById("origToggle").classList.toggle("active", showOriginal);
  });
  shadow.getElementById("bigger").addEventListener("click", () => { scale = Math.min(1.8, scale + 0.15); applyScale(); });
  shadow.getElementById("smaller").addEventListener("click", () => { scale = Math.max(0.6, scale - 0.15); applyScale(); });
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
    a.download = `livesub-transcript-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.srt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CAPTION_SHOW") {
      host.style.display = "";
      setLine(msg.original || "", msg.translated || "");
    } else if (msg.type === "CAPTION_STATUS") {
      if (msg.state === "error" || msg.state === "rate_limited") setNotice(msg.detail || msg.state);
      else if (msg.state === "stopped") { transEl.textContent = "Captions stopped."; transEl.classList.add("empty"); origEl.textContent = ""; }
    } else if (msg.type === "OVERLAY_PREPARE") {
      host.style.display = "";
      showOriginal = msg.showOriginal !== false;
      shadow.getElementById("origToggle").classList.toggle("active", showOriginal);
      transEl.textContent = "Listening…";
      transEl.classList.add("empty");
    } else if (msg.type === "OVERLAY_IDLE") {
      transEl.textContent = "Captions are off.";
      transEl.classList.add("empty");
    }
  });

  window.__livesubOverlay = {
    wake() { host.style.display = ""; }
  };
})();
