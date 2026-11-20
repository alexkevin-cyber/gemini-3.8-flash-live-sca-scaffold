"""Centralized application settings for Gemini 3.8 Live Scaffold.

CUSTOMIZATION GUIDE:
- Override any setting via environment variables or a local `.env` file.
- To change the voice, set `GEMINI_VOICE_NAME` (e.g., Aoede, Kore, Puck, Charon, Fenrir, Leda).
- To change the Vertex AI region for `gemini-3.8-live`, set `GOOGLE_CLOUD_LOCATION`
  (supported regions: us-central1, asia-south1, us, eu).
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Authentication & Platform ---
    # Default uses Vertex AI with Application Default Credentials (ideal for Cloud Run).
    google_genai_use_vertexai: bool = True
    google_cloud_project: str = ""
    google_cloud_location: str = "us-central1"
    # Companion search model location (Gemini 3.8 Flash uses global endpoint on Vertex AI).
    google_cloud_search_location: str = "global"
    # Optional: set google_genai_use_vertexai=false and provide an API key to use Gemini Developer API.
    gemini_api_key: str | None = None

    # --- Gemini 3.8 Live Configuration ---
    gemini_live_model: str = "gemini-3.8-live"
    gemini_search_model: str = "gemini-3.8-flash"
    gemini_voice_name: str = "Aoede"
    gemini_language_code: str = "id-ID"

    # Audio specifications required by Gemini 3.8 Live:
    # Input: Raw 16-bit PCM, 16kHz, mono, little-endian
    # Output: Raw 16-bit PCM, 24kHz, mono, little-endian
    input_sample_rate: int = 16000
    output_sample_rate: int = 24000

    # Context window compression extends audio sessions beyond the default 15-minute limit.
    enable_context_compression: bool = True

    # --- Server Configuration ---
    host: str = "0.0.0.0"
    port: int = 8080
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance."""
    return Settings()
