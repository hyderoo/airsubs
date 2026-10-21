# AirSubs — Live Captions & Translation

A Chrome extension that captions any tab in real time. It listens to the audio
of the tab you are on — YouTube, Twitch, a livestream, a lecture recording —
and shows floating subtitles on top of the video: the words as spoken, plus a
translation into the language you pick.

![icon](icons/icon128.png)

## Features

- **Live captions from tab audio** — captures the tab's own audio stream, no
  microphone involved, so it works with headphones and muted speakers.
- **~100 source languages** — Whisper Large v3 (Turbo) detects the spoken
  language automatically, or pin it yourself.
- **Two-line subtitles** — translation on top, original line underneath
  (toggleable). Drag the caption box anywhere; it remembers its place per site.
- **On-device translation when possible** — uses Chrome's built-in Translator
  for supported language pairs (free, unlimited, low latency) and falls back to
  an open-weight LLM for everything else.
- **Transcript export** — one click saves the session as an `.srt` file.
- **Free to run** — see "Cost" below.

## Install (unpacked)

1. Clone or download this repo.
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select this folder.
4. Click the AirSubs icon → **Settings** and paste your Groq API key
   (free — create one at <https://console.groq.com/keys>, sign in with Google,
   "Create API Key"; takes about two minutes, no card required).

## Use

1. Open the tab with the video or livestream and start playback.
2. Click the AirSubs icon → pick the audio language (Auto-detect works) and
   the translation target → **Start captions**.
3. Subtitles appear on the page a few seconds behind the audio.

## Cost

Designed to run at $0 on Groq's free tier:

| Piece | What it uses | Free allowance |
| --- | --- | --- |
| Transcription | `whisper-large-v3-turbo` | 20 req/min, 2,000 req/day, 7,200 audio-sec/hour, 28,800 audio-sec/day (~8 h/day) |
| Translation (primary) | Chrome's on-device Translator API | unlimited |
| Translation (fallback) | `openai/gpt-oss-120b` | 30 req/min, 1,000 req/day, 200K tokens/day |

Notes:

- Captions are chunked (default 6 s). Shorter chunks feel snappier but burn the
  free quota faster (Groq bills a 10 s minimum per request); longer chunks are
  gentler. Adjustable in Settings.
- When the daily free quota runs out, the extension says so and stops; the
  quota resets at midnight UTC.
- If you outgrow the free tier, Groq's paid Whisper Turbo is $0.04 per audio
  hour. Nothing in the extension requires payment — that is purely a Groq
  account upgrade.
- Your API key is stored in `chrome.storage.local` and never leaves your
  browser except to authenticate with `api.groq.com`.

## How it works

```
popup (start, languages)
   │ chrome.tabCapture.getMediaStreamId
   ▼
offscreen document ── MediaRecorder chunks (webm/opus)
   │ POST /openai/v1/audio/transcriptions  (Groq Whisper)
   ▼
on-device Translator API, else POST /chat/completions (Groq)
   ▼
content-script overlay (shadow DOM) ── draggable caption box + .srt export
```

Manifest V3. No build step, no dependencies — plain HTML/JS/CSS.

## Limitations

- Live means a few seconds of delay (chunk length + API round trip).
- Captioned/DRM-protected players that block tab audio capture may not work.
- Chrome only (uses `chrome.tabCapture` and the Chrome Translator API).
- Whisper accuracy drops on heavy accents, overlapping speech, and loud music.

## License

MIT
