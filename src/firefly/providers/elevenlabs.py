"""ElevenLabs provider — used by stage 5 (audio) for SFX layers."""

from __future__ import annotations

import httpx

from ..config import require_env

SFX_ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation"
KEY_HINT = "Get a key at https://elevenlabs.io/app/settings/api-keys"
MAX_DURATION_S = 30.0


def generate_sfx(prompt: str, *, duration_s: float = 30.0, loop: bool = True) -> bytes:
    """Generate a sound effect. Returns MP3 bytes.

    `loop=True` makes the audio seamlessly loopable — critical for ambient layers we
    repeat for hours. Cap is 30s per API call.
    """
    key = require_env("ELEVENLABS_API_KEY", KEY_HINT)
    resp = httpx.post(
        SFX_ENDPOINT,
        headers={"xi-api-key": key, "Content-Type": "application/json"},
        json={
            "text": prompt,
            "duration_seconds": min(duration_s, MAX_DURATION_S),
            "prompt_influence": 0.4,
            "loop": loop,
            "model_id": "eleven_text_to_sound_v2",
        },
        timeout=120,
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"ElevenLabs SFX failed ({resp.status_code}): {resp.text[:300]}"
        )
    return resp.content
