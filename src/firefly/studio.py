"""Firefly Studio — the new one-at-a-time + retry data model.

Replaces the v1 "generate N variations + pick one" pipeline. Each step keeps a
full history of attempts; the user re-selects any prior attempt at any time.

Storage:
- One `project.json` per project (this module's source of truth).
- New attempts live under `attempts/<step>/v<N>.<ext>` with sibling `.meta.json`.
- "Selected" outputs are copied to top-level `final_<step>.<ext>` so the user
  can see what was used by listing the project directory in Finder.

Legacy projects with an old `state.json` are migrated on first read. The old
files stay on disk (they're referenced by attempt filenames in the migrated
project.json) so playback in the new UI just works.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .config import PROJECTS_ROOT
from .schemas import JobStatus


# =============================================================================
# Schema
# =============================================================================


class Attempt(BaseModel):
    """One generation result within a step. Immutable once written."""
    id: str                # "v1", "v2", ...
    filename: str          # relative to project root, e.g. "attempts/image/v3.png"
    prompt: str            # text that produced this; for clip, a join of motion prompts
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    cost_usd: float = 0.0


class ImageStep(BaseModel):
    # Resolution dispatches the image, edit, and clip models:
    #   720p / 1080p — Flux Pro v1.1 (1MP) + Kontext + Kling v3 pro (1080p native)
    #   4k           — Flux Pro Ultra (4MP) + Seedream v4 Edit (4K) + Kling v3 4K (3840×2160 native)
    prompt: str = ""
    resolution: str = "1080p"          # "720p" | "1080p" | "4k"
    attempts: list[Attempt] = Field(default_factory=list)
    chosen_attempt_id: str | None = None
    confirmed: bool = False


class ClipStep(BaseModel):
    motion_prompts: list[str] = Field(default_factory=list)
    duration_s: int = 10               # 1..30 in the new flow
    # Loop-crossfade window used by make_loopable during final render. Longer =
    # softer/smoother loop boundary but more of the original clip's tail content
    # is consumed by the blend. Hard upper bound: must be < duration_s / 2.
    loop_xfade_s: float = 2.5
    attempts: list[Attempt] = Field(default_factory=list)
    chosen_attempt_id: str | None = None
    confirmed: bool = False


class SfxLayer(BaseModel):
    layer_id: str                      # slug of title; stable
    title: str
    prompt: str
    gain_db: float = -12.0
    enabled_in_mix: bool = True
    attempts: list[Attempt] = Field(default_factory=list)
    chosen_attempt_id: str | None = None
    deleted: bool = False              # soft delete; files preserved


class SfxStep(BaseModel):
    layers: list[SfxLayer] = Field(default_factory=list)
    confirmed: bool = False


class MusicStep(BaseModel):
    prompt: str = ""
    skipped: bool = False
    attempts: list[Attempt] = Field(default_factory=list)
    chosen_attempt_id: str | None = None
    confirmed: bool = False


class MixStep(BaseModel):
    # keys are layer_ids (for SFX layers) or the special "_music" key
    layer_gains: dict[str, float] = Field(default_factory=dict)
    disabled_layers: list[str] = Field(default_factory=list)
    preview_duration_s: int = 60
    previews: list[Attempt] = Field(default_factory=list)
    confirmed: bool = False


class FinalRender(BaseModel):
    id: str                # "r1", "r2", ...
    variant_name: str
    duration_min: int
    filename: str          # relative to project root, e.g. "final_video_xyz.mp4"
    bytes: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FinalStep(BaseModel):
    duration_min: int = 30
    renders: list[FinalRender] = Field(default_factory=list)
    chosen_render_id: str | None = None
    completed_at: datetime | None = None


class StudioConfig(BaseModel):
    # 1-MP Flux for 720p/1080p prototyping (cheap, fast)
    image_model: str = "fal-ai/flux-pro/v1.1"
    # 4-MP Flux Ultra for true-4K image gen (~same price, 4x the detail)
    image_model_4k: str = "fal-ai/flux-pro/v1.1-ultra"
    image_edit_model: str = "fal-ai/flux-pro/kontext"  # 1MP img-to-img for 720p/1080p Remix
    # Seedream v4 Edit does native 4K img-to-img — used when Remix is run on a 4K project.
    image_edit_model_4k: str = "fal-ai/bytedance/seedream/v4/edit"
    # 1080p-native Kling for 720p/1080p
    video_model: str = "fal-ai/kling-video/v3/pro/image-to-video"
    # 4K-native Kling for true 4K (≈3.75x cost: $0.42/sec vs $0.112/sec)
    video_model_4k: str = "fal-ai/kling-video/v3/4k/image-to-video"
    music_model: str = "cassetteai/music-generator"
    music_duration_s: int = 180
    plan_model: str = "claude-sonnet-4-6"   # kept for compatibility / future use


class StudioProject(BaseModel):
    slug: str
    title: str
    created_at: datetime
    last_modified_at: datetime
    config: StudioConfig = Field(default_factory=StudioConfig)
    image: ImageStep = Field(default_factory=ImageStep)
    clip: ClipStep = Field(default_factory=ClipStep)
    sfx: SfxStep = Field(default_factory=SfxStep)
    music: MusicStep = Field(default_factory=MusicStep)
    mix: MixStep = Field(default_factory=MixStep)
    final: FinalStep = Field(default_factory=FinalStep)
    current_job: JobStatus | None = None
    legacy: bool = False                      # True if migrated from v1 schema


# =============================================================================
# Slug helpers
# =============================================================================

_SLUG_KEEP = re.compile(r"[^a-z0-9\s-]")
_WS_DASH = re.compile(r"[\s_]+")
_DOUBLE_DASH = re.compile(r"-{2,}")


def derive_slug(title: str) -> str:
    """Normalize a title into a filesystem-safe slug."""
    s = title.lower().strip()
    s = _SLUG_KEEP.sub("", s)
    s = _WS_DASH.sub("-", s)
    s = _DOUBLE_DASH.sub("-", s)
    s = s.strip("-")
    return s


def ensure_unique_slug(title: str, root: Path | None = None) -> str:
    """Derive a slug from a title; append -2, -3, ... if needed to make it unique."""
    projects_dir = root or PROJECTS_ROOT
    base = derive_slug(title) or "untitled"
    slug = base
    n = 2
    while (projects_dir / slug).exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


# =============================================================================
# Persistence: StudioStore
# =============================================================================


class StudioStore:
    """File-backed I/O for a single project. Knows the directory layout.

    Use `StudioStore(slug).load()` to read; new projects come into existence via
    `StudioStore(slug).create(title)`. Legacy projects (no project.json, but an
    old state.json present) migrate automatically on load.
    """

    def __init__(self, slug: str, root: Path | None = None):
        self.slug = slug
        self.root = (root or PROJECTS_ROOT) / slug

    # ---- paths ----
    @property
    def project_json_path(self) -> Path:
        return self.root / "project.json"

    @property
    def attempts_dir(self) -> Path:
        return self.root / "attempts"

    @property
    def uploads_dir(self) -> Path:
        return self.root / "uploads"

    def attempt_dir(self, step: str, sublayer: str | None = None) -> Path:
        p = self.attempts_dir / step
        if sublayer is not None:
            p = p / sublayer
        return p

    @property
    def costs_path(self) -> Path:
        return self.root / "costs.jsonl"

    def selected_image_path(self) -> Path:
        return self.root / "final_image.png"

    def selected_clip_path(self) -> Path:
        return self.root / "final_clip.mp4"

    def selected_music_path(self) -> Path:
        return self.root / "final_music.wav"

    def selected_sfx_path(self, layer_id: str) -> Path:
        return self.root / f"final_sfx_{layer_id}.mp3"

    def final_video_path(self, variant_name: str) -> Path:
        return self.root / f"final_video_{variant_name}.mp4"

    # ---- existence / lifecycle ----
    def exists(self) -> bool:
        return self.project_json_path.exists() or (self.root / "state.json").exists()

    def is_new_schema(self) -> bool:
        return self.project_json_path.exists()

    def create(self, title: str) -> StudioProject:
        """Create a fresh project for the already-resolved slug."""
        if self.exists():
            raise FileExistsError(f"project '{self.slug}' already exists at {self.root}")
        self.root.mkdir(parents=True, exist_ok=True)
        self.attempts_dir.mkdir(exist_ok=True)
        now = datetime.utcnow()
        project = StudioProject(
            slug=self.slug,
            title=title,
            created_at=now,
            last_modified_at=now,
        )
        self.save(project)
        return project

    def load(self) -> StudioProject:
        if self.project_json_path.exists():
            return StudioProject.model_validate_json(self.project_json_path.read_text())
        # legacy migration on first read
        return self._migrate_from_legacy()

    def save(self, project: StudioProject) -> None:
        project.last_modified_at = datetime.utcnow()
        _atomic_write_text(self.project_json_path, project.model_dump_json(indent=2))

    # ---- legacy migration ----
    def _migrate_from_legacy(self) -> StudioProject:
        """Convert v1 schema files (state.json, plan.json, manifests, mix.json,
        final_variants.json, .pick files) into a StudioProject.

        Old files are NOT moved. Attempt filenames reference the old paths so
        the new UI plays back legacy assets directly. New attempts after
        migration go to attempts/ in the new layout.
        """
        from .project import Project as LegacyProject  # local import to avoid cycles
        from .schemas import StageStatus

        legacy = LegacyProject(self.slug)
        state = legacy.load_state()

        plan = None
        if legacy.plan_path.exists():
            try:
                plan = legacy.load_plan()
            except Exception:
                plan = None

        image_manifest = legacy.load_image_manifest()
        clip_manifest = legacy.load_clip_manifest()
        mix = legacy.load_mix()
        finals = legacy.load_final_variants()

        title = state.concept[:60] if state.concept else state.slug

        # --- image step
        image_step = ImageStep(
            prompt=(plan.image_prompts[0] if plan and plan.image_prompts else state.concept),
            resolution=state.config.resolution,
        )
        for i, item in enumerate(image_manifest.items, 1):
            att = Attempt(
                id=f"v{i}",
                filename=f"images/{item.filename}",
                prompt=item.prompt,
                config={"resolution": state.config.resolution, "seed": item.seed},
                created_at=state.stages.get("images", _empty_stage()).completed_at or state.created_at,
            )
            image_step.attempts.append(att)
            if item.approved and image_step.chosen_attempt_id is None:
                image_step.chosen_attempt_id = att.id
                image_step.confirmed = True

        # --- clip step
        clip_prompts = list(plan.clip_prompts) if plan else []
        clip_step = ClipStep(
            motion_prompts=clip_prompts[:3],   # take first few as a starting point
            duration_s=int(state.config.clip_duration_s),
        )
        for i, item in enumerate(clip_manifest.items, 1):
            att = Attempt(
                id=f"v{i}",
                filename=f"clips/{item.filename}",
                prompt=item.prompt,
                config={"duration_s": item.duration_s, "image_id": item.image_id},
                created_at=state.stages.get("clips", _empty_stage()).completed_at or state.created_at,
            )
            clip_step.attempts.append(att)
            if item.approved and clip_step.chosen_attempt_id is None:
                clip_step.chosen_attempt_id = att.id
                clip_step.confirmed = True

        # --- sfx step (per-layer history)
        sfx_step = SfxStep(confirmed=state.stages.get("audio", _empty_stage()).status == StageStatus.DONE)
        if plan:
            from .stages.audio import _safe
            for sfx_layer in plan.sfx_layers:
                safe = _safe(sfx_layer.name)
                layer = SfxLayer(
                    layer_id=safe,
                    title=sfx_layer.name,
                    prompt=sfx_layer.prompt,
                    gain_db=sfx_layer.gain_db,
                )
                # Scan intermediate/ for existing variation files
                for v in range(1, 21):
                    old_path = self.root / "intermediate" / f"sfx_{safe}_v{v}.mp3"
                    if not old_path.exists():
                        break
                    layer.attempts.append(Attempt(
                        id=f"v{v}",
                        filename=f"intermediate/sfx_{safe}_v{v}.mp3",
                        prompt=sfx_layer.prompt,
                        config={"gain_db": sfx_layer.gain_db, "title": sfx_layer.name},
                        created_at=state.created_at,
                    ))
                # read the .pick sidecar for chosen
                pick_file = self.root / "intermediate" / f"sfx_{safe}.pick"
                if pick_file.exists():
                    layer.chosen_attempt_id = pick_file.read_text().strip()
                elif layer.attempts:
                    layer.chosen_attempt_id = "v1"
                sfx_step.layers.append(layer)

        # --- music step
        music_mood = plan.music_mood if plan else ""
        skipped = bool(music_mood and music_mood.startswith("None"))
        music_step = MusicStep(prompt="" if skipped else music_mood, skipped=skipped)
        for v in range(1, 21):
            old_path = self.root / "intermediate" / f"music_bed_v{v}.wav"
            if not old_path.exists():
                break
            music_step.attempts.append(Attempt(
                id=f"v{v}",
                filename=f"intermediate/music_bed_v{v}.wav",
                prompt=music_mood,
                config={},
                created_at=state.created_at,
            ))
        # If no variations exist but canonical does, register canonical as v1
        canonical_music = self.root / "intermediate" / "music_bed.wav"
        if not music_step.attempts and canonical_music.exists() and not skipped:
            music_step.attempts.append(Attempt(
                id="v1",
                filename="intermediate/music_bed.wav",
                prompt=music_mood,
                config={},
                created_at=state.created_at,
            ))
            music_step.chosen_attempt_id = "v1"
        else:
            pick_file = self.root / "intermediate" / "music_bed.pick"
            if pick_file.exists():
                music_step.chosen_attempt_id = pick_file.read_text().strip()
            elif music_step.attempts:
                music_step.chosen_attempt_id = "v1"
        if music_step.attempts or skipped:
            music_step.confirmed = True

        # --- mix step
        mix_step = MixStep(
            layer_gains=dict(mix.layer_gains),
            disabled_layers=list(mix.disabled_layers),
            confirmed=any(mix.layer_gains) or bool(mix.disabled_layers),
        )

        # --- final step
        final_step = FinalStep(duration_min=state.config.target_duration_minutes)
        for i, v in enumerate(finals.items, 1):
            final_step.renders.append(FinalRender(
                id=f"r{i}",
                variant_name=v.name,
                duration_min=v.duration_min,
                filename=v.mp4_path,
                bytes=v.bytes,
                created_at=v.created_at,
            ))
        if final_step.renders:
            final_step.chosen_render_id = final_step.renders[-1].id

        project = StudioProject(
            slug=self.slug,
            title=title,
            created_at=state.created_at,
            last_modified_at=state.created_at,
            config=StudioConfig(
                image_model=state.config.image_model,
                video_model=state.config.video_model,
                music_model=state.config.music_model,
                music_duration_s=state.config.music_duration_s,
                plan_model=state.config.plan_model,
            ),
            image=image_step,
            clip=clip_step,
            sfx=sfx_step,
            music=music_step,
            mix=mix_step,
            final=final_step,
            current_job=state.current_job,
            legacy=True,
        )
        self.save(project)
        return project


# =============================================================================
# Project discovery
# =============================================================================


def list_all_projects(projects_root: Path | None = None) -> list[StudioProject]:
    """List every project (new + legacy) sorted by last_modified desc.

    Migrates legacy projects on first scan as a side effect — gives every
    listed project the StudioProject shape so the gallery UI can be uniform.
    """
    root = projects_root or PROJECTS_ROOT
    if not root.is_dir():
        return []
    out: list[StudioProject] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        store = StudioStore(child.name, root=root)
        if not store.exists():
            continue
        try:
            out.append(store.load())
        except Exception:
            continue   # skip malformed projects rather than crashing the gallery
    out.sort(key=lambda p: p.last_modified_at, reverse=True)
    return out


# =============================================================================
# Internal helpers
# =============================================================================


def _empty_stage() -> Any:
    """Return an object with .completed_at = None and .status = pending, for migration."""
    from .schemas import StageState
    return StageState()


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=path.suffix)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def attempt_meta_path(attempt_file: Path) -> Path:
    """Sibling .meta.json path for an attempt file."""
    return attempt_file.with_suffix(attempt_file.suffix + ".meta.json")


def next_attempt_id(attempts: list[Attempt]) -> str:
    """Return v<N+1> given an existing list of attempts."""
    n = 0
    for a in attempts:
        if a.id.startswith("v"):
            try:
                n = max(n, int(a.id[1:]))
            except ValueError:
                pass
    return f"v{n + 1}"


__all__ = [
    "Attempt",
    "ImageStep",
    "ClipStep",
    "SfxLayer",
    "SfxStep",
    "MusicStep",
    "MixStep",
    "FinalRender",
    "FinalStep",
    "StudioConfig",
    "StudioProject",
    "StudioStore",
    "derive_slug",
    "ensure_unique_slug",
    "list_all_projects",
    "attempt_meta_path",
    "next_attempt_id",
]
