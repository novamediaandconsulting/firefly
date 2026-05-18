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


@router.post("/render")
def render_variant(slug: str, req: RenderRequest) -> dict:
    proj = load_project(slug)
    final_path = render_stage.run(
        proj,
        variant=req.variant,
        duration_min=req.duration_min,
        audio_mode=req.audio_mode,
        force=req.force,
    )
    return {"final": str(final_path.relative_to(proj.root))}


@router.get("/variants", response_model=FinalVariants)
def list_variants(slug: str) -> FinalVariants:
    return load_project(slug).load_final_variants()
