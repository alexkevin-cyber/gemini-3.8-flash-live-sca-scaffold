"""API routes: health check, public frontend config, and Gemini 3.8 Live WebSocket."""

from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket
from pydantic import BaseModel

from backend.config.settings import Settings, get_settings
from backend.live.session import GeminiLiveSession

router = APIRouter()

SettingsDep = Annotated[Settings, Depends(get_settings)]


class HealthResponse(BaseModel):
    status: str
    model: str
    voice: str
    language: str


class PublicConfigResponse(BaseModel):
    model: str
    voice: str
    language: str
    input_sample_rate: int
    output_sample_rate: int


@router.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health_check(settings: SettingsDep) -> HealthResponse:
    """Cloud Run readiness & liveness probe."""
    return HealthResponse(
        status="ok",
        model=settings.gemini_live_model,
        voice=settings.gemini_voice_name,
        language=settings.gemini_language_code,
    )


@router.get("/api/config", response_model=PublicConfigResponse, tags=["system"])
async def public_config(settings: SettingsDep) -> PublicConfigResponse:
    """Expose non-sensitive session metadata for the web frontend."""
    return PublicConfigResponse(
        model=settings.gemini_live_model,
        voice=settings.gemini_voice_name,
        language=settings.gemini_language_code,
        input_sample_rate=settings.input_sample_rate,
        output_sample_rate=settings.output_sample_rate,
    )


@router.websocket("/ws/live")
async def live_websocket_endpoint(
    websocket: WebSocket,
    settings: SettingsDep,
) -> None:
    """Bidirectional WebSocket endpoint bridging browser audio/text to Gemini 3.8 Live."""
    live_session = GeminiLiveSession(websocket=websocket, settings=settings)
    await live_session.run()
