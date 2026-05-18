"""Images: generate candidates, approve, regenerate one."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...schemas import ImageManifest, StageStatus
from ...stages import images as images_stage
from ..deps import load_project

router = APIRouter(prefix="/api/projects/{slug}/images", tags=["images"])


@router.get("", response_model=ImageManifest)
def get_images(slug: str) -> ImageManifest:
    return load_project(slug).load_image_manifest()


class GenerateImagesRequest(BaseModel):
    count: int = 4
    force: bool = False


@router.post("", response_model=ImageManifest)
def generate_images(slug: str, req: GenerateImagesRequest) -> ImageManifest:
    proj = load_project(slug)
    images_stage.run(proj, count=req.count, force=req.force)
    return proj.load_image_manifest()


class ApproveRequest(BaseModel):
    ids: list[str]


@router.post("/approve", response_model=ImageManifest)
def approve_images(slug: str, req: ApproveRequest) -> ImageManifest:
    proj = load_project(slug)
    manifest = proj.load_image_manifest()
    found: set[str] = set()
    for item in manifest.items:
        if item.id in req.ids:
            item.approved = True
            found.add(item.id)
    missing = set(req.ids) - found
    if missing:
        raise HTTPException(404, f"unknown image IDs: {sorted(missing)}")
    proj.save_image_manifest(manifest)
    state = proj.load_state()
    state.stage("images").status = StageStatus.DONE
    proj.save_state(state)
    return manifest


class UnapproveRequest(BaseModel):
    ids: list[str]


@router.post("/unapprove", response_model=ImageManifest)
def unapprove_images(slug: str, req: UnapproveRequest) -> ImageManifest:
    """Un-approve images (e.g. user backed up from clips to re-pick)."""
    proj = load_project(slug)
    manifest = proj.load_image_manifest()
    for item in manifest.items:
        if item.id in req.ids:
            item.approved = False
    proj.save_image_manifest(manifest)
    return manifest


class RegenImageRequest(BaseModel):
    prompt: str | None = None


@router.post("/{image_id}/regen", response_model=ImageManifest)
def regen_image(slug: str, image_id: str, req: RegenImageRequest) -> ImageManifest:
    proj = load_project(slug)
    images_stage.regen(proj, image_id, prompt=req.prompt)
    return proj.load_image_manifest()
