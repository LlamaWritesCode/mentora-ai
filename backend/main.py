import asyncio
import json
import logging
import os

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.genai import types as genai_types

from mentora_agent.agent      import build_agent
from mentora_agent.notes_bus  import drain as drain_notes
from mentora_agent.widget_bus import drain as drain_widgets

load_dotenv("mentora_agent/.env")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

if not os.environ.get("GOOGLE_API_KEY"):
    raise RuntimeError("GOOGLE_API_KEY is not set. Copy mentora_agent/.env.example to mentora_agent/.env and add your key.")

app = FastAPI(title="Mentora Backend")

session_service = InMemorySessionService()
APP_NAME = "mentora"

_VALID_TONES  = {"casual", "academic", "formal", "socratic"}
_VALID_LEVELS = {"beginner", "intermediate", "advanced", "expert"}
_MAX_CUSTOM_LEN = 500
_MAX_TEXT_LEN   = 4000


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    log.info("Extension connected")

    agent_config = {
        "tone": "academic", "level": "intermediate", "custom": "",
        "a2ui_enabled": False, "socratic_autopilot": False,
    }
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=5.0)
        msg = json.loads(raw)
        if msg.get("type") == "session_config":
            tone  = msg.get("tone",  "academic")
            level = msg.get("level", "intermediate")
            agent_config = {
                "tone":               tone  if tone  in _VALID_TONES  else "academic",
                "level":              level if level in _VALID_LEVELS else "intermediate",
                "custom":             str(msg.get("custom", ""))[:_MAX_CUSTOM_LEN],
                "a2ui_enabled":       bool(msg.get("a2uiEnabled",       False)),
                "socratic_autopilot": bool(msg.get("socraticAutopilot", False)),
            }
            log.info(
                "Session config: tone=%s level=%s a2ui=%s socratic=%s",
                agent_config["tone"], agent_config["level"],
                agent_config["a2ui_enabled"], agent_config["socratic_autopilot"],
            )
    except asyncio.TimeoutError:
        log.info("No session config received — using defaults")
    except Exception as e:
        log.warning("Could not parse session config: %s", e)

    agent = build_agent(**agent_config)

    session = await session_service.create_session(
        app_name=APP_NAME,
        user_id="local_user",
    )

    runner = Runner(
        agent=agent,
        app_name=APP_NAME,
        session_service=session_service,
    )

    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=[genai_types.Modality.AUDIO],
        realtime_input_config=genai_types.RealtimeInputConfig(
            automaticActivityDetection=genai_types.AutomaticActivityDetection(
                startOfSpeechSensitivity=genai_types.StartSensitivity.START_SENSITIVITY_HIGH,
                endOfSpeechSensitivity=genai_types.EndSensitivity.END_SENSITIVITY_HIGH,
                silenceDurationMs=300,
                prefixPaddingMs=20,
            ),
        ),
    )
    log.info("RunConfig created")

    live_queue = LiveRequestQueue()

    try:
        await asyncio.gather(
            _receive_from_extension(ws, live_queue),
            _run_agent_and_stream(ws, runner, session, live_queue, run_config),
        )
    except (WebSocketDisconnect, RuntimeError):
        log.info("Extension disconnected cleanly")
    except Exception as e:
        log.error("Session error: %s", e, exc_info=True)
        try:
            await ws.send_json({"type": "error", "message": "An internal error occurred."})
        except Exception:
            pass
    finally:
        live_queue.close()
        log.info("Session closed")


async def _receive_from_extension(ws: WebSocket, live_queue: LiveRequestQueue):
    async for raw in _ws_iter(ws):
        if isinstance(raw, bytes):
            tag  = raw[0]
            data = bytes(raw[1:])
            if tag == 0x01:
                live_queue.send_realtime(genai_types.Blob(mime_type="image/jpeg", data=data))
            elif tag == 0x02:
                live_queue.send_realtime(genai_types.Blob(mime_type="audio/pcm;rate=16000", data=data))
        elif isinstance(raw, str):
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError as e:
                log.warning("Invalid JSON from extension: %s", e)
                continue
            if msg.get("type") == "user_text":
                text = str(msg.get("text", "")).strip()
                if not text or len(text) > _MAX_TEXT_LEN:
                    log.warning("Rejected user_text: length=%d", len(text))
                    continue
                log.info("Received text: %s", text)
                live_queue.send_content(genai_types.Content(
                    role="user",
                    parts=[genai_types.Part(text=text)],
                ))
    live_queue.close()


async def _run_agent_and_stream(
    ws: WebSocket,
    runner: Runner,
    session,
    live_queue: LiveRequestQueue,
    run_config: RunConfig,
):
    try:
        log.info("run_live started — waiting for events")
        text_buffer: list[str] = []
        last_sent_text: str = ""
        pending_user_transcript: str = ""

        async for event in runner.run_live(
            user_id="local_user",
            session_id=session.id,
            live_request_queue=live_queue,
            run_config=run_config,
        ):
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.inline_data and part.inline_data.mime_type.startswith("audio/"):
                        await ws.send_bytes(part.inline_data.data)

            if event.input_transcription and event.input_transcription.text:
                t = event.input_transcription.text.strip()
                if t:
                    if not pending_user_transcript:
                        last_sent_text = ""
                    pending_user_transcript = t
                    log.info("User said: %s", t)
                    await ws.send_json({"type": "user_transcript", "text": t})

            if event.output_transcription and event.output_transcription.text:
                if event.partial:
                    text_buffer.append(event.output_transcription.text)
                else:
                    text_buffer = [event.output_transcription.text]

            if event.interrupted:
                log.info("Barge-in — sending stop_audio")
                text_buffer.clear()
                pending_user_transcript = ""
                await ws.send_json({"type": "stop_audio"})

            if event.turn_complete:
                if text_buffer:
                    full_text = "".join(text_buffer).strip()
                    if full_text and full_text != last_sent_text:
                        log.info("Agent said: %s", full_text)
                        await ws.send_json({"type": "agent_text", "text": full_text})
                        last_sent_text = full_text
                    text_buffer.clear()
                for note in drain_notes():
                    log.info("Sending note: %s", note["topic"])
                    await ws.send_json({"type": "add_note", **note})
                for widget in drain_widgets():
                    log.info("Sending widget: %s", widget["widget_type"])
                    await ws.send_json({"type": "widget_render", **widget})
                await ws.send_json({"type": "thinking", "value": False})
                pending_user_transcript = ""

    except Exception as e:
        err_str = str(e)
        if "1000" in err_str:
            log.info("run_live ended cleanly (1000)")
        else:
            log.error("run_live error: %s", e, exc_info=True)


async def _ws_iter(ws: WebSocket):
    while True:
        try:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            elif "text" in msg:
                yield msg["text"]
            elif "bytes" in msg:
                yield msg["bytes"]
        except (WebSocketDisconnect, RuntimeError):
            break


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host=host, port=port, reload=False)
