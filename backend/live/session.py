"""Gemini 3.8 Live Bidirectional WebSocket Session Bridge.

This module bridges a browser WebSocket connection with the Gemini 3.8 Live API:
- Browser -> Backend: Raw 16kHz 16-bit PCM binary audio frames + JSON control/text messages.
- Backend -> Browser: Raw 24kHz 16-bit PCM binary audio frames + JSON transcript/canvas/status events.

CUSTOMIZATION GUIDE:
- Adjust `build_live_config()` to tweak Gemini 3.8 Live parameters such as voice,
  ASR custom vocabulary, VAD sensitivity, or context window compression.
- `send_initial_greeting()` triggers the assistant to speak first as soon as the session opens.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from backend.config.prompts import (
    CUSTOM_VOCABULARY,
    INITIAL_GREETING_PROMPT,
    SYSTEM_INSTRUCTION,
)
from backend.config.settings import Settings
from backend.live.tools import ToolExecutor, get_tool_declarations

logger = logging.getLogger(__name__)


def build_genai_client(settings: Settings) -> genai.Client:
    """Create the Google Gen AI SDK client for Gemini 3.8 Live."""
    if settings.google_genai_use_vertexai:
        return genai.Client(
            vertexai=True,
            project=settings.google_cloud_project,
            location=settings.google_cloud_location,
        )
    return genai.Client(api_key=settings.gemini_api_key)


def build_live_config(settings: Settings) -> types.LiveConnectConfig:
    """Build the Gemini 3.8 Live session configuration.

    Notes for Gemini 3.8 Live:
    - Affective dialogue and proactive audio are enabled by default in 3.8 Live.
    - Thinking level is not configurable on `gemini-3.8-live` (omit thinking_config).
    - Prebuilt HD voice `Aoede` speaks natural Bahasa Indonesia when guided by system_instruction.
    - `input_audio_transcription` & `output_audio_transcription` enable real-time transcripts.
    """
    input_transcription_kwargs: dict[str, Any] = {}
    if CUSTOM_VOCABULARY:
        input_transcription_kwargs["custom_vocabulary"] = CUSTOM_VOCABULARY

    config_kwargs: dict[str, Any] = {
        "response_modalities": [types.Modality.AUDIO],
        "speech_config": types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=settings.gemini_voice_name,
                )
            ),
        ),
        "system_instruction": SYSTEM_INSTRUCTION,
        "input_audio_transcription": types.AudioTranscriptionConfig(**input_transcription_kwargs),
        "output_audio_transcription": types.AudioTranscriptionConfig(),
        "tools": get_tool_declarations(),
    }

    if settings.enable_context_compression:
        config_kwargs["context_window_compression"] = types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow(),
        )

    return types.LiveConnectConfig(**config_kwargs)


class GeminiLiveSession:
    """Manages one bidirectional WebSocket session between a browser client and Gemini 3.8 Live."""

    def __init__(self, websocket: WebSocket, settings: Settings) -> None:
        self._ws = websocket
        self._settings = settings
        self._send_lock = asyncio.Lock()
        self._tool_tasks: dict[str, asyncio.Task[None]] = {}
        self._tool_executor = ToolExecutor(settings=settings, emit_canvas=self._emit_canvas)

    async def _send_json(self, payload: dict[str, Any]) -> None:
        async with self._send_lock:
            await self._ws.send_text(json.dumps(payload, ensure_ascii=False))

    async def _send_audio(self, pcm_bytes: bytes) -> None:
        async with self._send_lock:
            await self._ws.send_bytes(pcm_bytes)

    async def _emit_canvas(self, payload: dict[str, Any]) -> None:
        await self._send_json({"type": "canvas_update", "payload": payload})

    async def run(self) -> None:
        """Accept the WebSocket, open Gemini 3.8 Live, and run full-duplex I/O loops."""
        await self._ws.accept()
        await self._send_json(
            {
                "type": "status",
                "status": "connecting",
                "message": "Menghubungkan ke Gemini 3.8 Live...",
            }
        )

        client = build_genai_client(self._settings)
        live_config = build_live_config(self._settings)

        try:
            async with client.aio.live.connect(
                model=self._settings.gemini_live_model,
                config=live_config,
            ) as session:
                logger.info(
                    "Connected to %s (voice=%s, location=%s)",
                    self._settings.gemini_live_model,
                    self._settings.gemini_voice_name,
                    self._settings.google_cloud_location,
                )
                await self._send_json(
                    {
                        "type": "status",
                        "status": "connected",
                        "message": "Terhubung dengan Asisten AI",
                        "model": self._settings.gemini_live_model,
                        "voice": self._settings.gemini_voice_name,
                    }
                )

                # Trigger the AI to greet the user first in Bahasa Indonesia
                await session.send_client_content(
                    turns=types.Content(
                        role="user",
                        parts=[types.Part(text=INITIAL_GREETING_PROMPT)],
                    ),
                    turn_complete=True,
                )

                client_to_gemini = asyncio.create_task(
                    self._forward_client_to_gemini(session),
                    name="client_to_gemini",
                )
                gemini_to_client = asyncio.create_task(
                    self._forward_gemini_to_client(session),
                    name="gemini_to_client",
                )

                done, pending = await asyncio.wait(
                    [client_to_gemini, gemini_to_client],
                    return_when=asyncio.FIRST_COMPLETED,
                )

                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)

                for task in done:
                    exc = task.exception()
                    if exc and not isinstance(exc, (WebSocketDisconnect, asyncio.CancelledError)):
                        logger.error("Session loop error: %s", exc, exc_info=exc)
                        await self._safe_send_error(f"Terjadi gangguan sesi: {exc}")

        except WebSocketDisconnect:
            logger.info("Client disconnected cleanly.")
        except Exception as exc:
            logger.exception("Failed to run Gemini 3.8 Live session")
            await self._safe_send_error(
                f"Gagal terhubung ke Gemini 3.8 Live ({self._settings.gemini_live_model}): {exc}"
            )
        finally:
            await self._cancel_all_tools()

    async def _safe_send_error(self, message: str) -> None:
        try:
            await self._send_json({"type": "status", "status": "error", "message": message})
        except Exception:
            pass

    async def _forward_client_to_gemini(self, session: Any) -> None:
        """Read mic PCM audio and text/control messages from the browser and send to Gemini."""
        audio_mime = f"audio/pcm;rate={self._settings.input_sample_rate}"

        while True:
            message = await self._ws.receive()
            msg_type = message.get("type")

            if msg_type == "websocket.disconnect":
                break

            if message.get("bytes"):
                await session.send_realtime_input(
                    audio=types.Blob(data=message["bytes"], mime_type=audio_mime)
                )
                continue

            if message.get("text"):
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue

                event_type = data.get("type")
                if event_type == "text":
                    user_text = (data.get("text") or "").strip()
                    if user_text:
                        await session.send_client_content(
                            turns=types.Content(
                                role="user",
                                parts=[types.Part(text=user_text)],
                            ),
                            turn_complete=True,
                        )
                elif event_type == "ping":
                    await self._send_json({"type": "pong"})

    async def _forward_gemini_to_client(self, session: Any) -> None:
        """Receive streaming audio, transcripts, barge-in signals, and tool calls from Gemini."""
        while True:
            async for response in session.receive():
                # 1. Server Content: Audio, Transcripts, Interruption (Barge-in), Turn Complete
                server_content = getattr(response, "server_content", None)
                if server_content:
                    if getattr(server_content, "interrupted", False):
                        logger.debug("Barge-in detected: notifying frontend to flush audio buffer.")
                        await self._send_json({"type": "interrupted"})

                    # User speech transcription (16kHz input -> text)
                    input_tx = getattr(server_content, "input_transcription", None)
                    if input_tx and getattr(input_tx, "text", None):
                        await self._send_json(
                            {
                                "type": "transcript",
                                "role": "user",
                                "text": input_tx.text,
                                "finished": bool(getattr(input_tx, "finished", False)),
                            }
                        )

                    # Assistant speech transcription (24kHz output -> text)
                    output_tx = getattr(server_content, "output_transcription", None)
                    if output_tx and getattr(output_tx, "text", None):
                        await self._send_json(
                            {
                                "type": "transcript",
                                "role": "assistant",
                                "text": output_tx.text,
                                "finished": bool(getattr(output_tx, "finished", False)),
                            }
                        )

                    # Model audio chunks (and fallback text parts if any)
                    model_turn = getattr(server_content, "model_turn", None)
                    if model_turn and getattr(model_turn, "parts", None):
                        for part in model_turn.parts:
                            inline_data = getattr(part, "inline_data", None)
                            if inline_data and getattr(inline_data, "data", None):
                                await self._send_audio(inline_data.data)

                    if getattr(server_content, "turn_complete", False):
                        await self._send_json({"type": "turn_complete"})

                # 2. Asynchronous Function / Tool Calls
                tool_call = getattr(response, "tool_call", None)
                if tool_call and getattr(tool_call, "function_calls", None):
                    for fn_call in tool_call.function_calls:
                        call_id = fn_call.id
                        task = asyncio.create_task(
                            self._run_tool_and_respond(session, fn_call),
                            name=f"tool_{fn_call.name}_{call_id}",
                        )
                        self._tool_tasks[call_id] = task
                        task.add_done_callback(lambda _t, cid=call_id: self._tool_tasks.pop(cid, None))

                # 3. Tool Call Cancellation (when user interrupts during a pending call)
                cancellation = getattr(response, "tool_call_cancellation", None)
                if cancellation and getattr(cancellation, "ids", None):
                    for cid in cancellation.ids:
                        task = self._tool_tasks.pop(cid, None)
                        if task and not task.done():
                            task.cancel()

                # 4. GoAway notice before WebSocket lifetime limit
                if getattr(response, "go_away", None):
                    logger.warning("Received GoAway from Gemini Live API.")
                    await self._send_json(
                        {
                            "type": "status",
                            "status": "warning",
                            "message": "Sesi akan segera berakhir, silakan mulai ulang jika diperlukan.",
                        }
                    )

    async def _run_tool_and_respond(self, session: Any, fn_call: Any) -> None:
        """Execute a tool asynchronously and return a strictly matched FunctionResponse."""
        call_id = fn_call.id
        name = fn_call.name
        args = dict(fn_call.args) if fn_call.args else {}

        logger.info("Executing tool call: %s(%s)", name, args)
        await self._send_json(
            {
                "type": "tool_status",
                "tool": name,
                "status": "running",
                "query": args.get("query") or args.get("title") or "",
            }
        )

        try:
            result = await self._tool_executor.execute(name, args)
            await session.send_tool_response(
                function_responses=[
                    types.FunctionResponse(
                        id=call_id,
                        name=name,
                        response=result,
                    )
                ]
            )
            await self._send_json(
                {
                    "type": "tool_status",
                    "tool": name,
                    "status": "done",
                }
            )
        except asyncio.CancelledError:
            logger.info("Cancelled tool call %s (%s)", name, call_id)
        except Exception as exc:
            logger.exception("Failed sending tool response for %s", name)
            await self._send_json(
                {
                    "type": "tool_status",
                    "tool": name,
                    "status": "error",
                    "message": str(exc),
                }
            )

    async def _cancel_all_tools(self) -> None:
        for task in list(self._tool_tasks.values()):
            if not task.done():
                task.cancel()
        if self._tool_tasks:
            await asyncio.gather(*self._tool_tasks.values(), return_exceptions=True)
        self._tool_tasks.clear()
