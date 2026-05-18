"""Audio: generate (with N variations per layer), regen SFX, pick winners, mux."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from ...stages import audio as audio_stage
from ...stages import mux as mux_stage
from ..deps import load_project

router = APIRouter(prefix="/api/projects/{slug}", tags=["audio"])


class AudioRunRequest(BaseModel):
    silent: bool = False
    stock: bool = False
    no_music: bool = False
    skip_sfx: bool = False
    sfx_variations: int = 3
    music_variations: int = 3
    force: bool = False


@router.post("/audio")
def generate_audio(slug: str, req: AudioRunRequest) -> dict:
    proj = load_project(slug)
    audio_stage.run(
        proj,
        silent=req.silent, stock=req.stock,
        no_music=req.no_music, skip_sfx=req.skip_sfx,
        sfx_variations=req.sfx_variations,
        music_variations=req.music_variations,
        force=req.force,
    )
    return {
        "audio_track": str(proj.audio_track_path.relative_to(proj.root)),
        "preview": str(proj.audio_preview_path.relative_to(proj.root)),
    }


class RegenSfxRequest(BaseModel):
    prompt: str | None = None
    variations: int = 3


@router.post("/sfx/{layer_name}/regen")
def regen_sfx(slug: str, layer_name: str, req: RegenSfxRequest) -> dict:
    proj = load_project(slug)
    audio_stage.regen_sfx(proj, layer_name, prompt=req.prompt, variations=req.variations)
    return {"status": "done"}


class GenerateSfxRequest(BaseModel):
    variations: int = 3


@router.post("/sfx/generate")
def generate_sfx_layers(slug: str, req: GenerateSfxRequest) -> dict:
    """Generate N variations for every SFX layer in the plan. No mixing."""
    proj = load_project(slug)
    audio_stage.ensure_all_sfx_variations(proj, variations=req.variations)
    return {"layers": audio_stage.list_sfx_variations(proj)}


class GenerateMusicRequest(BaseModel):
    variations: int = 3


@router.post("/music/generate")
def generate_music_variations(slug: str, req: GenerateMusicRequest) -> dict:
    """Generate N music bed variations. No mixing."""
    proj = load_project(slug)
    audio_stage.ensure_music_variations(proj, variations=req.variations)
    return audio_stage.list_music_variations(proj)


@router.get("/sfx")
def get_sfx_state(slug: str) -> dict:
    """List per-layer SFX variations + current pick."""
    proj = load_project(slug)
    return {"layers": audio_stage.list_sfx_variations(proj)}


@router.get("/music")
def get_music_state(slug: str) -> dict:
    """List music variations + current pick."""
    proj = load_project(slug)
    return audio_stage.list_music_variations(proj)


class PickRequest(BaseModel):
    variation: str  # e.g. "v2"


@router.post("/sfx/{layer_name}/pick")
def pick_sfx(slug: str, layer_name: str, req: PickRequest) -> dict:
    proj = load_project(slug)
    audio_stage.pick_sfx(proj, layer_name, req.variation)
    return {"status": "done"}


@router.post("/music/pick")
def pick_music(slug: str, req: PickRequest) -> dict:
    proj = load_project(slug)
    audio_stage.pick_music(proj, req.variation)
    return {"status": "done"}


class MuxRequest(BaseModel):
    force: bool = False


@router.post("/mux")
def run_mux(slug: str, req: MuxRequest) -> dict:
    proj = load_project(slug)
    mux_stage.run(proj, force=req.force)
    final = proj.final_dir / f"{proj.slug}_{proj.load_state().config.target_duration_minutes}min.mp4"
    return {"final": str(final.relative_to(proj.root))}
