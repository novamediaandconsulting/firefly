"""Render: named final variants (no API calls)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from ...schemas import FinalVariants
from ...stages import render as render_stage
from ..deps import load_project

router = APIRouter(prefix="/api/projects/{slug}", tags=["render"])


class RenderRequest(BaseModel):
    variant: str
    duration_min: int = 30
    audio_mode: str = "default"
    force: bool = False


@router.post("/render", status_code=202)
def render_variant(slug: str, req: RenderRequest) -> dict:
    """Kick off a render in a background thread.

    Render time is roughly proportional to duration (1080p H.264 + ffmpeg loop
    + amix mux). Frontend polls GET /variants to see the new variant appear
    when finished, and GET /project to know when current_job clears.
    """
    from ..jobs import start_job
    proj = load_project(slug)
    job = start_job(
        proj, stage="render",
        message=f"rendering '{req.variant}' ({req.duration_min} min, {req.audio_mode})",
        fn=lambda: render_stage.run(
            proj,
            variant=req.variant,
            duration_min=req.duration_min,
            audio_mode=req.audio_mode,
            force=req.force,
        ),
    )
    return {"status": "started", "job": job.model_dump(mode="json")}


@router.get("/variants", response_model=FinalVariants)
def list_variants(slug: str) -> FinalVariants:
    return load_project(slug).load_final_variants()
