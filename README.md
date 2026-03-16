# Mentora — Your Personal AI Tutor

**[Watch the Demo](https://youtube.com/watch?v=NxDOmTxRC-k&feature=youtu.be)** · **[GCP Proof](https://www.loom.com/share/8ff37798210843eba30ef9983d852d30)**

---

## Description

### What is Mentora?

Mentora is a real-time multimodal AI tutor built as a Chrome extension. It lives in the browser's side panel and watches your screen, listens to your voice, and responds in spoken audio — like having a tutor sitting next to you while you study, work through a problem set, or read a paper.

The core idea: most learning tools require you to context-switch. You pause, open a new tab, type a question, wait for text. Mentora removes that friction entirely. You just talk. It sees what you see and responds in under a second.

### Features

**Voice-first interaction**
- Continuous microphone capture with server-side voice activity detection (VAD)
- Gemini detects when you stop speaking (~300ms silence) and responds immediately in audio
- Full transcript shown in the side panel in real time

**Barge-in / interrupt**
- Speak over Mentora at any time to interrupt mid-response
- Local audio stops instantly; the backend confirms the interruption and discards the rest of the queued audio

**Screen awareness**
- A JPEG frame is captured from your active tab every 4 seconds
- Change detection skips static frames to avoid unnecessary API calls
- Mentora can reference specific elements on your screen by name in its responses

**Generative UI (A2UI)**
- When explaining concepts visually, Gemini calls tools that render interactive widgets directly in the side panel alongside its spoken response:
  - `ProbabilityTable` — horizontal bar chart for distributions and comparisons
  - `EquationSolver` — expandable step-by-step math derivations with KaTeX-rendered LaTeX
  - `Flashcard` — flippable term/definition card for new vocabulary

**Socratic Autopilot**
- Opt-in mode that transforms Mentora from an answer-giver into a Socratic guide
- Zero-Answer Policy: never gives direct answers, only questions and nudges
- Vision-Based Scaffolding: references what it literally sees on your screen
- 3-level Nudge Hierarchy: Inquiry → Connection → Analogy
- Proactive Whisper: after 30 seconds of idle time during a session, Mentora sends a screen-aware Socratic question unprompted (< 15 words)

**Smart notes**
- Say "save this", "add to notes", or "remember this" at any point
- Gemini calls `add_to_notes(topic, summary)` and the note appears in the Notes tab with a timestamp

**Tutor personalisation**
- Tone: casual / academic / formal / socratic
- Level: beginner / intermediate / advanced / expert
- Custom instruction: free-text field appended directly to the system prompt (e.g. "I am preparing for a machine learning interview")
- Voice source: mic only, or mic + tab audio (for tutoring over lecture videos)

**Text input fallback**
- Type questions into the side panel when voice is not practical
- Sent as `user_text` JSON and processed identically to spoken input

### Technologies Used

**Google**
- **Gemini Live API** (`gemini-2.5-flash-native-audio-preview`) — real-time bidirectional audio streaming with native speech understanding and generation
- **Google Agent Development Kit (ADK)** — `Runner`, `LiveRequestQueue`, `RunConfig` with `StreamingMode.BIDI` and `Modality.AUDIO`; tool-calling framework for all agent actions
- **Google Cloud** — backend deployed on Google Cloud Run; API key managed via Secret Manager

**Backend**
- Python 3.11, FastAPI, Uvicorn
- `asyncio.gather` for concurrent media ingestion and agent streaming
- Server VAD via `RealtimeInputConfig` / `AutomaticActivityDetection` (no client-side silence detection needed)
- Playwright for browser automation tools (`navigate`, `click_at`, `scroll_to_text`, `summarize_page`)

**Chrome Extension (MV3)**
- TypeScript, React 18, Vite, Tailwind CSS
- Offscreen Document API for WebSocket ownership, tab capture, mic capture, and audio playback
- `chrome.tabCapture` for screen capture; `chrome.sidePanel` for the UI surface
- `AudioContext` with manually decoded PCM16 buffers for gapless 24 kHz audio playback
- KaTeX for self-hosted LaTeX math rendering (CSP-compliant)
- `@fontsource/montserrat` for self-hosted font (no external network requests)

### Data Sources

No external datasets or third-party data sources were used. All knowledge comes from the Gemini model itself. The only runtime data is:

- The user's microphone audio (16 kHz PCM16, streamed live, never stored)
- JPEG frames of the user's active browser tab (captured locally, sent over WebSocket to backend, never persisted)

### Findings and Learnings

**Raw PCM16 playback is harder than it looks.** The Web Audio API's `decodeAudioData` silently garbles raw PCM16 — it expects a container format (WAV, MP3, etc.). We decode manually: read each 2-byte little-endian sample, divide by 32768, write into a `Float32Array`, and schedule buffers back-to-back using `source.start(startAt)` for seamless gapless output. Took a day to figure out why the audio sounded like static.

**Server VAD is the right architecture.** We initially tried client-side silence detection (energy thresholds, WebRTC VAD). Both required constant tuning and were brittle across microphones and environments. Switching to Gemini's built-in `AutomaticActivityDetection` with `silenceDurationMs=300` and `END_SENSITIVITY_HIGH` made the system dramatically more reliable with zero tuning effort.

**Barge-in requires both local and remote coordination.** Stopping audio locally is instant. But the WebSocket pipeline still has in-flight audio chunks. If you only stop locally, those chunks play the moment the next response starts (ghost audio). The fix: set `bargeInActive = true` locally to drop incoming chunks, wait for the backend's `stop_audio` confirmation to clear it. Add a 1s fallback in case the backend never sends one.

**Chrome extension security surfaces are easy to overlook.** Any page on the machine can send a `chrome.runtime.sendMessage` to an extension if it knows the extension ID. We added `sender.id !== chrome.runtime.id` checks on every `onMessage` listener and a WebSocket URL validator (must be `ws(s)://localhost`) to prevent content scripts or malicious pages from hijacking the session.

**Offscreen documents are the right place for media in MV3.** Service workers are ephemeral and have no DOM, so they cannot own a WebSocket or play audio. The offscreen document runs persistently as long as it has a registered reason, has full access to `getUserMedia`, `tabCapture`, and `AudioContext`, and communicates via `chrome.runtime.sendMessage`. This architecture keeps the service worker purely as a stateless message relay.

**Tool docstrings are the prompt.** In Google ADK, the docstring of a Python tool function is literally what Gemini reads to understand when and how to call it. Poorly written docstrings led to Gemini calling `render_generative_widget` with malformed JSON. Adding explicit schema examples in the docstring fixed it immediately.

---

## Setup & Spin-Up

The backend is deployed on **Google Cloud Run** — no server setup needed to run the app.

### Prerequisites

- Node.js 18+
- Google Chrome (latest)

### 1. Build the Extension

```bash
cd extension
npm install
npm run build
# Build output: extension/dist/
```

### 2. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder
5. Click the Mentora icon in the toolbar — the side panel opens
6. Hit **Start Sync** — connects directly to the Cloud Run backend

---

### Running Locally (for development)

If you want to run the backend locally instead of Cloud Run:

**Prerequisites:** Python 3.11+, a Gemini API key from [Google AI Studio](https://aistudio.google.com)

```bash
cd backend
pip install -r requirements.txt
cp mentora_agent/.env.example mentora_agent/.env
# Edit mentora_agent/.env and set GOOGLE_API_KEY=your_key_here
python main.py
# Server starts at http://127.0.0.1:8080
```

Then update `DEFAULT_WS_URL` in `extension/src/sidepanel/SidePanel.tsx` to `ws://localhost:8080/ws`, rebuild, and reload the extension.

```bash
# Extension — watch mode
cd extension && npm run dev

# Backend — auto-reload
uvicorn main:app --host 127.0.0.1 --port 8080 --reload
```

---

## Proof of Google Cloud Deployment

The Mentora backend is live on **Google Cloud Run** at:

`https://mentora-backend-703396951656.us-central1.run.app`

**Screen recording** — [Watch the GCP proof recording on Loom](https://www.loom.com/share/8ff37798210843eba30ef9983d852d30) — shows the Cloud Build pipeline (all 3 steps green), Cloud Run service dashboard, active revision, and live request logs.

**Code reference** — the following files in this repo demonstrate Google Cloud service usage:
- [`Dockerfile`](Dockerfile) — container definition for the FastAPI backend
- [`cloudbuild.yaml`](cloudbuild.yaml) — Cloud Build pipeline (build → push to Artifact Registry → deploy to Cloud Run)
- [`backend/mentora_agent/agent.py`](backend/mentora_agent/agent.py) — uses `google-adk` with `gemini-2.5-flash-native-audio-preview`, calling the Gemini Live API via Google Cloud

---

## Architecture Diagram

```text
┌──────────────────────────────────────────────────────────────────────┐
│                          User's Chrome Browser                       │
│                                                                      │
│   ┌─────────────────────┐      ┌──────────────────────────────────┐  │
│   │     Side Panel      │      │       Offscreen Document         │  │
│   │   (React + Vite)    │◄────►│  WebSocket  │  Media capture     │  │
│   │                     │      │  Tab video  │  Mic audio         │  │
│   │  - Chat transcript  │      │  PCM16 play │  Barge-in detect   │  │
│   │  - Notes tab        │      └──────┬───────────────────────────┘  │
│   │  - Widget renderer  │             │                              │
│   │  - Settings drawer  │      ┌──────▼──────────────────────────┐   │
│   └─────────────────────┘      │       Service Worker            │   │
│                                │   (message relay, orchestration)│   │
│                                └──────┬──────────────────────────┘   │
└───────────────────────────────────────┼──────────────────────────────┘
                                        │
                              WebSocket  ws://[host]:8080/ws
                         (binary: JPEG frames + PCM16 audio)
                         (JSON: transcripts, widgets, notes)
                                        │
┌───────────────────────────────────────▼──────────────────────────────┐
│                    Google Cloud Run (us-central1)                    │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │              FastAPI  /ws  WebSocket Handler                 │   │
│   │                                                              │   │
│   │   _receive_from_extension        _run_agent_and_stream       │   │
│   │   ─────────────────────         ──────────────────────       │   │
│   │   tag 0x01 → image/jpeg         audio bytes → extension      │   │
│   │   tag 0x02 → audio/pcm          JSON events → extension      │   │
│   │         │                              ▲                     │   │
│   │         ▼                              │                     │   │
│   │   LiveRequestQueue            ADK Runner + InMemorySession   │   │
│   │         │                              │                     │   │
│   └─────────┼──────────────────────────────┼─────────────────────┘   │
│             │                              │                         │
│   ┌─────────▼──────────────────────────────▼─────────────────────┐   │
│   │                   Google ADK Agent                           │   │
│   │            model: gemini-2.5-flash-native-audio-preview      │   │
│   │                                                              │   │
│   │   Tools:  navigate · click_at · scroll_to_text               │   │
│   │           summarize_page · add_to_notes                      │   │
│   │           render_generative_widget  (when A2UI on)           │   │
│   │                                                              │   │
│   │   Side effects:  notes_bus ──► add_note JSON to extension    │   │
│   │                  widget_bus ──► widget_render JSON           │   │
│   └──────────────────────────────────┬───────────────────────────┘   │
└──────────────────────────────────────┼───────────────────────────────┘
                                       │
                             BIDI streaming (audio I/O)
                                       │
                    ┌──────────────────▼──────────────────┐
                    │         Google Gemini Live API      │
                    │   gemini-2.5-flash-native-audio     │
                    │   - Understands speech natively     │
                    │   - Generates speech natively       │
                    │   - Server-side VAD built in        │
                    │   - Tool calling over live stream   │
                    └─────────────────────────────────────┘
```


---

## Demonstration Video

**Video link:** `[ADD VIDEO URL HERE]`

The video (< 4 minutes) covers:

1. **The problem** — context-switching kills learning flow; existing AI tools require you to stop, navigate away, type, and wait
2. **Live demo** — Mentora running in the Chrome side panel while browsing a statistics textbook:
   - Voice question answered in real time with screen context
   - Barge-in mid-response
   - Generative UI: `EquationSolver` widget rendered alongside the spoken explanation
   - Socratic Autopilot mode triggered after idle period
   - Note saved via voice command and visible in the Notes tab
3. **The value** — zero friction, zero context-switch, multimodal understanding baked in at the infrastructure level — not bolted on
