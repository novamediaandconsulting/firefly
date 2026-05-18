"""Images: generate candidates, approve, regenerate one, gallery."""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...schemas import ImageManifest, StageStatus
from ...stages import images as images_stage
from ..deps import load_project

router = APIRouter(prefix="/api/projects/{slug}/images", tags=["images"])


# Filename pattern for backup files: <stem>.bak<unix_ts>.png
_BACKUP_RE = re.compile(r"^(?P<base>.+?)\.bak(?P<ts>\d+)\.png$")


class GalleryImage(BaseModel):
    filename: str
    path: str  # relative to project root
    base_id: str
    is_current: bool
    timestamp: int | None
    prompt: str
    approved: bool


class GalleryGroup(BaseModel):
    base_id: str
    items: list[GalleryImage]  # current first, backups newest first


class ImageGalleryResponse(BaseModel):
    groups: list[GalleryGroup]
    extras: list[GalleryImage]  # images that don't match any base_id (e.g. one-off variations)


@router.get("/gallery", response_model=ImageGalleryResponse)
def get_gallery(slug: str) -> ImageGalleryResponse:
    """List every image in projects/<slug>/images/, current + backups, grouped.

    Includes:
    - Current candidates (img_NN.png) with their manifest prompts and
      approval state.
    - Backup files (<stem>.bakTTT.png) with prompts read from their sibling
      .prompt.txt files.
    - Extras (anything else ending in .png that doesn't fit either) listed
      separately so one-off side-experiments don't disappear from the UI.
    """
    proj = load_project(slug)
    manifest = proj.load_image_manifest()
    manifest_by_filename = {item.filename: item for item in manifest.items}

    if not proj.images_dir.is_dir():
        return ImageGalleryResponse(groups=[], extras=[])

    groups: dict[str, list[GalleryImage]] = {}
    extras: list[GalleryImage] = []

    for png in sorted(proj.images_dir.glob("*.png")):
        m = _BACKUP_RE.match(png.name)
        if m:
            base_filename = f"{m.group('base')}.png"
            base_id = m.group("base")
            ts = int(m.group("ts"))
            prompt_file = png.with_suffix(".prompt.txt")
            prompt = prompt_file.read_text().strip() if prompt_file.exists() else ""
            item = GalleryImage(
                filename=png.name,
                path=f"images/{png.name}",
                base_id=base_id,
                is_current=False,
                timestamp=ts,
                prompt=prompt,
                approved=False,
            )
            groups.setdefault(base_id, []).append(item)
            continue

        # Current candidate? (matches a manifest entry)
        mf = manifest_by_filename.get(png.name)
        if mf is not None:
            item = GalleryImage(
                filename=png.name,
                path=f"images/{png.name}",
                base_id=mf.id,
                is_current=True,
                timestamp=None,
                prompt=mf.prompt,
                approved=mf.approved,
            )
            groups.setdefault(mf.id, []).append(item)
        else:
            # An extra — e.g. images/img_01_cozy_a.png from a one-off script run.
            extras.append(
                GalleryImage(
                    filename=png.name,
                    path=f"images/{png.name}",
                    base_id=png.stem,
                    is_current=False,
                    timestamp=None,
                    prompt="(no prompt recorded)",
                    approved=False,
                )
            )

    # Sort within each group: current first, then backups by timestamp desc.
    out_groups: list[GalleryGroup] = []
    for base_id in sorted(groups.keys()):
        items = sorted(
            groups[base_id],
            key=lambda i: (0 if i.is_current else 1, -(i.timestamp or 0)),
        )
        out_groups.append(GalleryGroup(base_id=base_id, items=items))

    return ImageGalleryResponse(groups=out_groups, extras=extras)


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
