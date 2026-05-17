"""ElevenLabs provider — used by stage 5 (audio) for SFX layers."""

from __future__ import annotations

import httpx

from ..config import require_env

SFX_ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation"
KEY_HINT = "Get a key at https://elevenlabs.io/app/settings/api-keys"


def generate_sfx(prompt: str, *, duration_s: float = 22.0) -> bytes:
    """Generate a sound effect. Returns MP3 bytes. Max duration ~22s per call."""
    key = require_env("ELEVENLABS_API_KEY", KEY_HINT)
    resp = httpx.post(
        SFX_ENDPOINT,
        headers={"xi-api-key": key, "Content-Type": "application/json"},
        json={
            "text": prompt,
            "duration_seconds": min(duration_s, 22.0),
            "prompt_influence": 0.4,
        },
        timeout=120,
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"ElevenLabs SFX failed ({resp.status_code}): {resp.text[:300]}"
        )
    return resp.content
