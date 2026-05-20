"""Firefly Studio API routes — the new one-at-a-time + retry pipeline.

All paths under /api/projects/. These coexist with (and replace) several of
the legacy routes from images.py / clips.py / audio.py / mix.py / render.py;
the legacy ones live on until phase 12 cleanup so the old wizard pages don't
crash mid-rewrite.
"""

from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ... import costs as costs_mod
from ... import studio_jobs
from ...studio import (
    Attempt,
    StudioProject,
    StudioStore,
    derive_slug,
    ensure_unique_slug,
    list_all_projects,
)
from ..jobs import start_job

router = APIRouter(prefix="/api/projects", tags=["studio"])


# =============================================================================
# Helpers
# =============================================================================


def load_studio(slug: str) -> StudioStore:
    store = StudioStore(slug)
    if not store.exists():
        raise HTTPException(404, f"project '{slug}' not found")
    return store


def load_studio_project(slug: str) -> tuple[StudioStore, StudioProject]:
    store = load_studio(slug)
    return store, store.load()


class ProjectSummary(BaseModel):
    """Trimmed StudioProject view for the home gallery."""
    slug: str
    title: str
    created_at: datetime
    last_modified_at: datetime
    legacy: bool
    thumbnail_path: str | None        # relative to project root
    completed: bool
    current_step: str                  # title|image|clip|sfx|music|mix|final|done


def _summarize(p: StudioProject) -> ProjectSummary:
    thumb = None
    if p.image.chosen_attempt_id:
        for a in p.image.attempts:
            if a.id == p.image.chosen_attempt_id:
                thumb = a.filename
                break
    return ProjectSummary(
        slug=p.slug,
        title=p.title,
        created_at=p.created_at,
        last_modified_at=p.last_modified_at,
        legacy=p.legacy,
        thumbnail_path=thumb,
        completed=p.final.completed_at is not None,
        current_step=_current_step(p),
    )


def _current_step(p: StudioProject) -> str:
    if p.final.completed_at:
        return "done"
    if not p.image.confirmed:
        return "image"
    if not p.clip.confirmed:
        return "clip"
    if not p.sfx.confirmed:
        return "sfx"
    if not p.music.confirmed:
        return "music"
    if not p.mix.confirmed:
        return "mix"
    return "final"


# =============================================================================
# Projects (gallery, create, read, delete)
# =============================================================================


@router.get("", response_model=list[ProjectSummary])
def list_projects() -> list[ProjectSummary]:
    return [_summarize(p) for p in list_all_projects()]


class SlugPreview(BaseModel):
    raw_slug: str
    final_slug: str         # the unique one after suffixing if needed
    conflict: bool          # True if raw_slug clashed and a suffix was applied


@router.get("/slug-preview", response_model=SlugPreview)
def slug_preview(title: str) -> SlugPreview:
    raw = derive_slug(title) or "untitled"
    final = ensure_unique_slug(title)
    return SlugPreview(raw_slug=raw, final_slug=final, conflict=raw != final)


class CreateProjectRequest(BaseModel):
    title: str


@router.post("", response_model=StudioProject, status_code=201)
def create_project(req: CreateProjectRequest) -> StudioProject:
    title = req.title.strip()
    if not title:
        raise HTTPException(400, "title is required")
    slug = ensure_unique_slug(title)
    return StudioStore(slug).create(title)


@router.get("/{slug}", response_model=StudioProject)
def get_project(slug: str) -> StudioProject:
    store = load_studio(slug)
    return store.load()


@router.delete("/{slug}", status_code=204)
def delete_project(slug: str, confirm: bool = False) -> None:
    if not confirm:
        raise HTTPException(400, "pass ?confirm=true to actually delete the project")
    store = load_studio(slug)
    shutil.rmtree(store.root)


@router.delete("/{slug}/job", response_model=StudioProject)
def clear_job(slug: str) -> StudioProject:
    """Force-clear current_job. Doesn't stop the worker thread; use when stuck."""
    store, project = load_studio_project(slug)
    project.current_job = None
    store.save(project)
    return project


class TitleUpdate(BaseModel):
    title: str


@router.put("/{slug}/title", response_model=StudioProject)
def update_title(slug: str, req: TitleUpdate) -> StudioProject:
    store, project = load_studio_project(slug)
    project.title = req.title.strip() or project.title
    store.save(project)
    return project


@router.get("/{slug}/cost-by-step")
def cost_by_step(slug: str) -> dict:
    store = load_studio(slug)
    entries = costs_mod.load_entries(_legacy_proxy(store))
    by_step: dict[str, float] = {}
    for e in entries:
        # Old stage names sometimes used singular/plural — normalize to studio steps
        step = _normalize_stage(e.stage)
        by_step[step] = by_step.get(step, 0.0) + e.cost_usd
    return {"by_step": by_step, "total_usd": sum(by_step.values())}


# =============================================================================
# Image step
# =============================================================================


class ImageGenerateRequest(BaseModel):
    prompt: str
    resolution: str = "1080p"


@router.post("/{slug}/image/generate", status_code=202)
def image_generate(slug: str, req: ImageGenerateRequest) -> dict:
    store = load_studio(slug)
    job = start_job(
        _legacy_proxy(store), stage="image",
        message=f"generating image @ {req.resolution}",
        fn=lambda: studio_jobs.generate_image(slug, req.prompt, req.resolution),
    )
    return {"status": "started", "job": job.model_dump(mode="json")}


@router.post("/{slug}/image/select/{attempt_id}", response_model=Attempt)
def image_select(slug: str, attempt_id: str) -> Attempt:
    return studio_jobs.select_image(slug, attempt_id)


@router.post("/{slug}/image/confirm", response_model=StudioProject)
def image_confirm(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    if not project.image.chosen_attempt_id:
        raise HTTPException(400, "select an image attempt first")
    project.image.confirmed = True
    store.save(project)
    return project


@router.post("/{slug}/image/unconfirm", response_model=StudioProject)
def image_unconfirm(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    project.image.confirmed = False
    store.save(project)
    return project


# =============================================================================
# Clip step
# =============================================================================


class ClipGenerateRequest(BaseModel):
    motion_prompts: list[str]
    duration_s: int = 10


@router.post("/{slug}/clip/generate", status_code=202)
def clip_generate(slug: str, req: ClipGenerateRequest) -> dict:
    if req.duration_s < 1 or req.duration_s > 30:
        raise HTTPException(400, "duration must be between 1 and 30 seconds")
    store = load_studio(slug)
    job = start_job(
        _legacy_proxy(store), stage="clip",
        message=f"generating {req.duration_s}s clip"
                + (" (chained 15+15)" if req.duration_s > 15 else ""),
        fn=lambda: studio_jobs.generate_clip(slug, req.motion_prompts, req.duration_s),
    )
    return {"status": "started", "job": job.model_dump(mode="json")}


@router.post("/{slug}/clip/select/{attempt_id}", response_model=Attempt)
def clip_select(slug: str, attempt_id: str) -> Attempt:
    return studio_jobs.select_clip(slug, attempt_id)


@router.post("/{slug}/clip/confirm", response_model=StudioProject)
def clip_confirm(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    if not project.clip.chosen_attempt_id:
        raise HTTPException(400, "select a clip attempt first")
    project.clip.confirmed = True
    store.save(project)
    return project


@router.post("/{slug}/clip/unconfirm", response_model=StudioProject)
def clip_unconfirm(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    project.clip.confirmed = False
    store.save(project)
    return project


# =============================================================================
# SFX step
# =============================================================================


class SfxAddLayerRequest(BaseModel):
    title: str
    prompt: str = ""
    gain_db: float = -12.0


@router.post("/{slug}/sfx/layers", response_model=StudioProject)
def sfx_add_layer(slug: str, req: SfxAddLayerRequest) -> StudioProject:
    from ...studio import SfxLayer, derive_slug
    store, project = load_studio_project(slug)
    base = derive_slug(req.title) or "layer"
    layer_id = base
    n = 2
    while any(l.layer_id == layer_id and not l.deleted for l in project.sfx.layers):
        layer_id = f"{base}-{n}"
        n += 1
    project.sfx.layers.append(SfxLayer(
        layer_id=layer_id, title=req.title,
        prompt=req.prompt, gain_db=req.gain_db,
    ))
    store.save(project)
    return project


class SfxUpdateLayerRequest(BaseModel):
    title: str | None = None
    prompt: str | None = None
    gain_db: float | None = None
    enabled_in_mix: bool | None = None


@router.put("/{slug}/sfx/layers/{layer_id}", response_model=StudioProject)
def sfx_update_layer(slug: str, layer_id: str, req: SfxUpdateLayerRequest) -> StudioProject:
    store, project = load_studio_project(slug)
    layer = _find_layer_or_404(project, layer_id)
    if req.title is not None: layer.title = req.title
    if req.prompt is not None: layer.prompt = req.prompt
    if req.gain_db is not None: layer.gain_db = req.gain_db
    if req.enabled_in_mix is not None: layer.enabled_in_mix = req.enabled_in_mix
    store.save(project)
    return project


@router.delete("/{slug}/sfx/layers/{layer_id}", response_model=StudioProject)
def sfx_delete_layer(slug: str, layer_id: str) -> StudioProject:
    store, project = load_studio_project(slug)
    layer = _find_layer_or_404(project, layer_id)
    layer.deleted = True
    store.save(project)
    return project


class SfxGenerateRequest(BaseModel):
    title: str
    prompt: str
    gain_db: float


@router.post("/{slug}/sfx/layers/{layer_id}/generate", status_code=202)
def sfx_generate(slug: str, layer_id: str, req: SfxGenerateRequest) -> dict:
    store = load_studio(slug)
    job = start_job(
        _legacy_proxy(store), stage="sfx",
        message=f"generating SFX for '{req.title}'",
        fn=lambda: studio_jobs.generate_sfx(
            slug, layer_id, req.title, req.prompt, req.gain_db,
        ),
    )
    return {"status": "started", "job": job.model_dump(mode="json")}


@router.post("/{slug}/sfx/layers/{layer_id}/select/{attempt_id}", response_model=Attempt)
def sfx_select(slug: str, layer_id: str, attempt_id: str) -> Attempt:
    return studio_jobs.select_sfx(slug, layer_id, attempt_id)


@router.post("/{slug}/sfx/confirm", response_model=StudioProject)
def sfx_confirm(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    project.sfx.confirmed = True
    store.save(project)
    return project


@router.post("/{slug}/sfx/unconfirm", response_model=StudioProject)
def sfx_unconfirm(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    project.sfx.confirmed = False
    store.save(project)
    return project


# =============================================================================
# Music step
# =============================================================================


MUSIC_MODELS = {
    "cassetteai/music-generator",
    "beatoven/music-generation",
}


class MusicConfigRequest(BaseModel):
    model: str


@router.put("/{slug}/music/config", response_model=StudioProject)
def music_config(slug: str, req: MusicConfigRequest) -> StudioProject:
    if req.model not in MUSIC_MODELS:
        raise HTTPException(
            400,
            f"unsupported music model: {req.model} (allowed: {sorted(MUSIC_MODELS)})",
        )
    store, project = load_studio_project(slug)
    project.config.music_model = req.model
    store.save(project)
    return project


class MusicGenerateRequest(BaseModel):
    prompt: str


@router.post("/{slug}/music/generate", status_code=202)
def music_generate(slug: str, req: MusicGenerateRequest) -> dict:
    store = load_studio(slug)
    job = start_job(
        _legacy_proxy(store), stage="music",
        message="generating music bed",
        fn=lambda: studio_jobs.generate_music(slug, req.prompt),
    )
    return {"status": "started", "job": job.model_dump(mode="json")}


@router.post("/{slug}/music/select/{attempt_id}", response_model=Attempt)
def music_select(slug: str, attempt_id: str) -> Attempt:
    return studio_jobs.select_music(slug, attempt_id)


@router.post("/{slug}/music/skip", response_model=StudioProject)
def music_skip(slug: str) -> StudioProject:
    return studio_jobs.skip_music(slug)


@router.post("/{slug}/music/confirm", response_model=StudioProject)
def music_confirm(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    if not project.music.skipped and not project.music.chosen_attempt_id:
        raise HTTPException(400, "select a music attempt or skip music first")
    project.music.confirmed = True
    store.save(project)
    return project


@router.post("/{slug}/music/unconfirm", response_model=StudioProject)
def music_unconfirm(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    project.music.confirmed = False
    store.save(project)
    return project


# =============================================================================
# Mix step
# =============================================================================


class MixUpdateRequest(BaseModel):
    layer_gains: dict[str, float]
    disabled_layers: list[str]
    preview_duration_s: int | None = None


@router.put("/{slug}/mix", response_model=StudioProject)
def mix_update(slug: str, req: MixUpdateRequest) -> StudioProject:
    store, project = load_studio_project(slug)
    project.mix.layer_gains = req.layer_gains
    project.mix.disabled_layers = req.disabled_layers
    if req.preview_duration_s is not None:
        project.mix.preview_duration_s = req.preview_duration_s
    store.save(project)
    return project


class MixPreviewRequest(BaseModel):
    duration_s: int = 60


@router.post("/{slug}/mix/preview", status_code=202)
def mix_preview(slug: str, req: MixPreviewRequest) -> dict:
    store = load_studio(slug)
    if req.duration_s < 5 or req.duration_s > 300:
        raise HTTPException(400, "preview duration must be 5-300 seconds")
    job = start_job(
        _legacy_proxy(store), stage="mix",
        message=f"rendering {req.duration_s}s preview",
        fn=lambda: studio_jobs.render_mix_preview(slug, req.duration_s),
    )
    return {"status": "started", "job": job.model_dump(mode="json")}


@router.post("/{slug}/mix/confirm", response_model=StudioProject)
def mix_confirm(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    project.mix.confirmed = True
    store.save(project)
    return project


@router.post("/{slug}/mix/unconfirm", response_model=StudioProject)
def mix_unconfirm(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    project.mix.confirmed = False
    store.save(project)
    return project


# =============================================================================
# Final step
# =============================================================================


class FinalUpdateRequest(BaseModel):
    duration_min: int


@router.put("/{slug}/final", response_model=StudioProject)
def final_update(slug: str, req: FinalUpdateRequest) -> StudioProject:
    if req.duration_min < 1:
        raise HTTPException(400, "duration must be at least 1 minute")
    store, project = load_studio_project(slug)
    project.final.duration_min = req.duration_min
    store.save(project)
    return project


class FinalRenderRequest(BaseModel):
    duration_min: int


@router.post("/{slug}/final/render", status_code=202)
def final_render(slug: str, req: FinalRenderRequest) -> dict:
    if req.duration_min < 1 or req.duration_min > 600:
        raise HTTPException(400, "duration must be 1-600 minutes")
    store = load_studio(slug)
    job = start_job(
        _legacy_proxy(store), stage="render",
        message=f"rendering {req.duration_min}-minute final",
        fn=lambda: studio_jobs.render_final(slug, req.duration_min),
    )
    return {"status": "started", "job": job.model_dump(mode="json")}


@router.post("/{slug}/final/complete", response_model=StudioProject)
def final_complete(slug: str) -> StudioProject:
    store, project = load_studio_project(slug)
    if not project.final.chosen_render_id:
        raise HTTPException(400, "no final render to complete")
    project.final.completed_at = datetime.utcnow()
    store.save(project)
    return project


# =============================================================================
# Helpers
# =============================================================================


def _find_layer_or_404(project, layer_id):
    for l in project.sfx.layers:
        if l.layer_id == layer_id and not l.deleted:
            return l
    raise HTTPException(404, f"sfx layer '{layer_id}' not found")


def _normalize_stage(stage: str) -> str:
    """Map legacy stage names to studio step names so cost-by-step is uniform."""
    mapping = {
        "images": "image",
        "clips": "clip",
        "audio": "sfx",     # legacy lumped audio = sfx + music; close enough for display
        "plan": "title",    # legacy plan -> title cost
        "mux": "render",
    }
    return mapping.get(stage, stage)


def _legacy_proxy(store: StudioStore):
    """Adapter for `start_job` (expects an object with .slug + .load_state / .save_state)."""
    from ...schemas import State, ProjectConfig, JobStatus
    project = store.load()

    class _Proxy:
        slug = store.slug
        costs_path = store.costs_path

        def load_state(self) -> State:
            return State(
                slug=project.slug,
                concept=project.title,
                created_at=project.created_at,
                config=ProjectConfig(),
                current_job=project.current_job,
            )

        def save_state(self, state: State) -> None:
            # Persist current_job back onto the studio project.
            p = store.load()
            p.current_job = state.current_job
            store.save(p)

    return _Proxy()
