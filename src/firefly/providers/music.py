"""Music provider — fal hosts CassetteAI and Beatoven for instrumental music gen.

We deliberately use a fal-hosted music model instead of Suno: there is no official
Suno API, and the third-party Suno wrappers are unstable and ToS-grey. Beatoven and
CassetteAI are explicitly tuned for instrumental/ambient — perfect for our use case.
"""

from __future__ import annotations

import fal_client
import httpx

from ..config import require_env

KEY_HINT = "Music generation uses your fal.ai key (FAL_KEY in .env)."


def _ensure_key() -> None:
    require_env("FAL_KEY", KEY_HINT)


def generate_music(
    prompt: str,
    *,
    duration_s: int = 180,
    model: str = "cassetteai/music-generator",
) -> tuple[bytes, dict]:
    """Generate an instrumental track. Returns (audio_bytes, metadata).

    The output is a WAV/MP3 — content type set by the model. Caller writes to disk
    and feeds into ffmpeg, which doesn't care about the container.
    """
    _ensure_key()
    args = {"prompt": prompt, "duration": int(duration_s)}
    # CassetteAI normally completes in <15s. 3-minute ceiling so a stuck
    # queue job at fal raises FalClientHTTPError instead of hanging the
    # worker forever; the user can then see the error in the wizard badge
    # and click Generate again rather than wondering what's happening.
    result = fal_client.subscribe(model, arguments=args, with_logs=False, timeout=180.0)
    audio = result.get("audio_file")
    if not audio or "url" not in audio:
        raise RuntimeError(f"fal {model} returned no audio: {result!r}")
    audio_bytes = httpx.get(audio["url"], timeout=300).content
    return audio_bytes, {"url": audio["url"]}
