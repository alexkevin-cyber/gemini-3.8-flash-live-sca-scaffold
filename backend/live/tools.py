"""Modular Tool Registry & Executor for Gemini 3.8 Live.

CUSTOMIZATION GUIDE — HOW TO ADD NEW FLOWS / TOOLS:
1. Declare your new function inside `get_tool_declarations()` using `types.FunctionDeclaration`.
   Tip: Keep `behavior=types.Behavior.NON_BLOCKING` so Gemini 3.8 Live can keep speaking
   naturally while your backend API or database call runs.
2. Implement an async handler method on `ToolExecutor` (e.g. `async def _handle_my_flow(self, args)`).
3. Register the handler name in `self._handlers` inside `ToolExecutor.__init__`.
4. Optionally call `await self._emit_canvas({...})` to render rich visual cards on the right panel!
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse

from google import genai
from google.genai import types

from backend.config.settings import Settings

logger = logging.getLogger(__name__)

CanvasEmitter = Callable[[dict[str, Any]], Awaitable[None]]


def get_tool_declarations() -> list[types.Tool]:
    """Return Gemini 3.8 Live tool declarations.

    Add your custom FunctionDeclarations here to extend the assistant's capabilities.
    """
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="search_web",
                    description=(
                        "Cari informasi terkini di Google Search dan tampilkan hasil pencarian "
                        "serta tautan sumbernya di panel kanan (Dynamic Canvas). Gunakan saat "
                        "pengguna bertanya tentang berita terbaru, fakta terkini, cuaca, harga, "
                        "rekomendasi, atau topik yang memerlukan pencarian web."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "query": types.Schema(
                                type=types.Type.STRING,
                                description="Kata kunci pencarian dalam Bahasa Indonesia atau bahasa yang paling relevan.",
                            ),
                        },
                        required=["query"],
                    ),
                    behavior=types.Behavior.NON_BLOCKING,
                ),
                types.FunctionDeclaration(
                    name="update_canvas",
                    description=(
                        "Tampilkan ringkasan terstruktur, daftar poin penting, perbandingan, "
                        "atau panduan langkah demi langkah di panel kanan agar pengguna dapat "
                        "membacanya sambil berdiskusi."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "title": types.Schema(
                                type=types.Type.STRING,
                                description="Judul utama yang ditampilkan di panel kanan.",
                            ),
                            "subtitle": types.Schema(
                                type=types.Type.STRING,
                                description="Subjudul singkat atau konteks topik.",
                            ),
                            "summary": types.Schema(
                                type=types.Type.STRING,
                                description="Ringkasan singkat dan jelas dalam Bahasa Indonesia.",
                            ),
                            "category": types.Schema(
                                type=types.Type.STRING,
                                description="Kategori tampilan: 'info', 'steps', 'comparison', atau 'notes'.",
                            ),
                            "items": types.Schema(
                                type=types.Type.ARRAY,
                                description="Daftar poin atau kartu informasi untuk ditampilkan.",
                                items=types.Schema(
                                    type=types.Type.OBJECT,
                                    properties={
                                        "heading": types.Schema(
                                            type=types.Type.STRING,
                                            description="Judul poin atau item.",
                                        ),
                                        "detail": types.Schema(
                                            type=types.Type.STRING,
                                            description="Penjelasan singkat item.",
                                        ),
                                        "tag": types.Schema(
                                            type=types.Type.STRING,
                                            description="Label singkat opsional (misal: 'Rekomendasi', 'Langkah 1').",
                                        ),
                                    },
                                    required=["heading", "detail"],
                                ),
                            ),
                        },
                        required=["title", "summary"],
                    ),
                    behavior=types.Behavior.NON_BLOCKING,
                ),
                types.FunctionDeclaration(
                    name="reset_canvas",
                    description="Kembalikan panel kanan ke halaman sapaan awal.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={},
                    ),
                    behavior=types.Behavior.NON_BLOCKING,
                ),
            ]
        )
    ]


class ToolExecutor:
    """Executes tool calls requested by Gemini 3.8 Live and updates the right-hand canvas."""

    def __init__(self, settings: Settings, emit_canvas: CanvasEmitter) -> None:
        self._settings = settings
        self._emit_canvas = emit_canvas
        self._search_client = self._build_search_client(settings)

        # Register tool handlers here when adding new flows.
        self._handlers: dict[str, Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]] = {
            "search_web": self._handle_search_web,
            "update_canvas": self._handle_update_canvas,
            "reset_canvas": self._handle_reset_canvas,
        }

    @staticmethod
    def _build_search_client(settings: Settings) -> genai.Client:
        if settings.google_genai_use_vertexai:
            return genai.Client(
                vertexai=True,
                project=settings.google_cloud_project,
                location=settings.google_cloud_search_location,
            )
        return genai.Client(api_key=settings.gemini_api_key)

    async def execute(self, name: str, args: dict[str, Any] | None) -> dict[str, Any]:
        """Dispatch a tool call by name and return a JSON-serializable dict for FunctionResponse."""
        handler = self._handlers.get(name)
        if not handler:
            logger.warning("Unknown tool requested: %s", name)
            return {"status": "error", "message": f"Tool '{name}' tidak dikenali."}

        try:
            return await handler(args or {})
        except asyncio.CancelledError:
            logger.info("Tool '%s' cancelled due to user interruption.", name)
            raise
        except Exception as exc:
            logger.exception("Error executing tool '%s'", name)
            return {"status": "error", "message": f"Gagal menjalankan {name}: {exc}"}

    async def _handle_search_web(self, args: dict[str, Any]) -> dict[str, Any]:
        """Run Google Search grounding via Gemini 3.8 Flash and push results to the right canvas."""
        query = (args.get("query") or "").strip()
        if not query:
            return {"status": "error", "message": "Kata kunci pencarian kosong."}

        # Immediately show a loading state on the right canvas
        await self._emit_canvas(
            {
                "mode": "loading",
                "title": "Mencari informasi...",
                "query": query,
            }
        )

        prompt = (
            f"Cari informasi terbaru dan paling akurat untuk pertanyaan/topik berikut: '{query}'.\n"
            "Berikan ringkasan yang jelas, padat, dan terstruktur dalam Bahasa Indonesia "
            "(maksimal 3-5 poin utama atau 2 paragraf singkat) agar mudah dibaca di layar dan "
            "dirangkum secara lisan."
        )

        response = await asyncio.to_thread(
            self._search_client.models.generate_content,
            model=self._settings.gemini_search_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )

        summary_text = (response.text or "").strip()
        sources: list[dict[str, str]] = []
        search_queries: list[str] = [query]

        if response.candidates:
            metadata = getattr(response.candidates[0], "grounding_metadata", None)
            if metadata:
                if getattr(metadata, "web_search_queries", None):
                    search_queries = list(metadata.web_search_queries)
                chunks = getattr(metadata, "grounding_chunks", None) or []
                seen_urls: set[str] = set()
                for chunk in chunks:
                    web = getattr(chunk, "web", None)
                    if not web or not getattr(web, "uri", None):
                        continue
                    url = web.uri
                    if url in seen_urls:
                        continue
                    seen_urls.add(url)
                    domain = urlparse(url).netloc.replace("www.", "")
                    sources.append(
                        {
                            "title": getattr(web, "title", None) or domain or "Sumber Web",
                            "url": url,
                            "domain": domain,
                        }
                    )

        await self._emit_canvas(
            {
                "mode": "search",
                "query": query,
                "queries": search_queries[:4],
                "title": f"Hasil Pencarian: {query}",
                "summary": summary_text or "Tidak ada ringkasan yang ditemukan.",
                "sources": sources[:6],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

        return {
            "status": "success",
            "query": query,
            "summary": summary_text,
            "sources_count": len(sources),
            "note": "Hasil pencarian dan sumber sudah ditampilkan di panel kanan. Jelaskan intinya secara singkat dan natural dalam Bahasa Indonesia.",
        }

    async def _handle_update_canvas(self, args: dict[str, Any]) -> dict[str, Any]:
        """Render structured discussion content on the right-hand canvas."""
        payload = {
            "mode": "structured",
            "title": args.get("title", "Ringkasan Diskusi"),
            "subtitle": args.get("subtitle", ""),
            "summary": args.get("summary", ""),
            "category": args.get("category", "info"),
            "items": args.get("items", []),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await self._emit_canvas(payload)
        return {
            "status": "success",
            "message": "Panel kanan berhasil diperbarui.",
        }

    async def _handle_reset_canvas(self, _args: dict[str, Any]) -> dict[str, Any]:
        """Reset the right-hand canvas back to its initial welcome view."""
        await self._emit_canvas({"mode": "welcome"})
        return {
            "status": "success",
            "message": "Panel kanan dikembalikan ke tampilan awal.",
        }
