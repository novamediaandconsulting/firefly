"""Mix: live preview + lock per-layer gain overrides."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from ...schemas import MixConfig
from ...stages import audio as audio_stage
from ..deps import load_project

router = APIRouter(prefix="/api/projects/{slug}/mix", tags=["mix"])


class MixPreviewRequest(BaseModel):
    layer_gains: dict[str, float]
    duration_s: int = 60


@router.post("/preview")
def mix_preview(slug: str, req: MixPreviewRequest) -> dict:
    """Render a short preview MP3 with overridden gains. Returns the file URL."""
    proj = load_project(slug)
    audio_stage.mix_preview(proj, req.layer_gains, duration_s=req.duration_s)
    return {
        "preview": str(proj.mix_preview_path.relative_to(proj.root)),
    }


@router.get("", response_model=MixConfig)
def get_mix(slug: str) -> MixConfig:
    return load_project(slug).load_mix()


@router.put("", response_model=MixConfig)
def lock_mix(slug: str, mix: MixConfig) -> MixConfig:
    """Persist mix.json — final renders honor these gains."""
    proj = load_project(slug)
    proj.save_mix(mix)
    return mix
