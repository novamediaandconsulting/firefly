"""Suno provider — used by stage 5 (audio) for music beds.

Stubbed until we provision a Suno API key together. For MVP, stage 5 falls back to
stock music files in assets/music/.
"""

from __future__ import annotations


def generate_music(prompt: str, *, duration_s: float) -> bytes:
    raise NotImplementedError(
        "Suno integration not wired yet — for MVP, drop a music file into assets/music/."
    )
