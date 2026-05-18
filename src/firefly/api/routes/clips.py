"""Clips: generate, approve, regenerate one, run loop stage."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...schemas import ClipManifest, StageStatus
from ...stages import clips as clips_stage
from ...stages import loop as loop_stage
from ..deps import load_project

router = APIRouter(prefix="/api/projects/{slug}/clips", tags=["clips"])


@router.get("", response_model=ClipManifest)
def get_clips(slug: str) -> ClipManifest:
    return load_project(slug).load_clip_manifest()


class GenerateClipsRequest(BaseModel):
    per_image: int = 3
    force: bool = False


@router.post("", status_code=202)
def generate_clips(slug: str, req: GenerateClipsRequest) -> dict:
    """Kick off clip generation in a background thread.

    Each clip is written to the manifest as it finishes; the frontend polls
    GET /clips to see new ones appear (~30-90s per clip on Kling).
    """
    from ..jobs import start_job
    proj = load_project(slug)
    job = start_job(
        proj, stage="clips",
        message=f"generating {req.per_image} clip(s) per approved image",
        fn=lambda: clips_stage.run(proj, per_image=req.per_image, force=req.force),
    )
    return {"status": "started", "job": job.model_dump(mode="json")}


class ApproveRequest(BaseModel):
    ids: list[str]


@router.post("/approve", response_model=ClipManifest)
def approve_clips(slug: str, req: ApproveRequest) -> ClipManifest:
    proj = load_project(slug)
    manifest = proj.load_clip_manifest()
    found: set[str] = set()
    for item in manifest.items:
        if item.id in req.ids:
            item.approved = True
            found.add(item.id)
    missing = set(req.ids) - found
    if missing:
        raise HTTPException(404, f"unknown clip IDs: {sorted(missing)}")
    proj.save_clip_manifest(manifest)
    state = proj.load_state()
    state.stage("clips").status = StageStatus.DONE
    proj.save_state(state)
    return manifest


@router.post("/unapprove", response_model=ClipManifest)
def unapprove_clips(slug: str, req: ApproveRequest) -> ClipManifest:
    proj = load_project(slug)
    manifest = proj.load_clip_manifest()
    for item in manifest.items:
        if item.id in req.ids:
            item.approved = False
    proj.save_clip_manifest(manifest)
    return manifest


class RegenClipRequest(BaseModel):
    prompt: str | None = None


@router.post("/{clip_id}/regen", response_model=ClipManifest)
def regen_clip(slug: str, clip_id: str, req: RegenClipRequest) -> ClipManifest:
    proj = load_project(slug)
    clips_stage.regen(proj, clip_id, prompt=req.prompt)
    return proj.load_clip_manifest()


# Loop endpoint lives here because it operates on approved clips.

class LoopRequest(BaseModel):
    duration_min: int | None = None
    force: bool = False


@router.post("/loop")
def build_loop(slug: str, req: LoopRequest) -> dict:
    proj = load_project(slug)
    loop_stage.run(proj, duration_min=req.duration_min, force=req.force)
    return {"video_track": str(proj.video_track_path.relative_to(proj.root))}
