import json
import os
import tempfile
from datetime import datetime
from pathlib import Path

from .config import PROJECTS_ROOT
from .schemas import (
    ClipManifest,
    ImageManifest,
    Plan,
    ProjectConfig,
    State,
)


class Project:
    def __init__(self, slug: str, root: Path | None = None):
        self.slug = slug
        self.root = (root or PROJECTS_ROOT) / slug

    # ---- paths ----
    @property
    def state_path(self) -> Path:
        return self.root / "state.json"

    @property
    def plan_path(self) -> Path:
        return self.root / "plan.json"

    @property
    def images_dir(self) -> Path:
        return self.root / "images"

    @property
    def image_manifest_path(self) -> Path:
        return self.images_dir / "manifest.json"

    @property
    def clips_dir(self) -> Path:
        return self.root / "clips"

    @property
    def clip_manifest_path(self) -> Path:
        return self.clips_dir / "manifest.json"

    @property
    def intermediate_dir(self) -> Path:
        return self.root / "intermediate"

    @property
    def video_track_path(self) -> Path:
        return self.intermediate_dir / "video_track.mp4"

    @property
    def audio_track_path(self) -> Path:
        return self.intermediate_dir / "audio_track.wav"

    @property
    def audio_preview_path(self) -> Path:
        return self.intermediate_dir / "preview.mp3"

    @property
    def final_dir(self) -> Path:
        return self.root / "final"

    @property
    def youtube_path(self) -> Path:
        return self.root / "youtube.json"

    # ---- existence ----
    def exists(self) -> bool:
        return self.state_path.exists()

    def ensure_dirs(self) -> None:
        for d in (
            self.root,
            self.images_dir,
            self.clips_dir,
            self.intermediate_dir,
            self.final_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)

    # ---- state ----
    def load_state(self) -> State:
        return State.model_validate_json(self.state_path.read_text())

    def save_state(self, state: State) -> None:
        _atomic_write_text(self.state_path, state.model_dump_json(indent=2))

    def create(self, concept: str, config: ProjectConfig | None = None) -> State:
        if self.exists():
            raise FileExistsError(f"Project '{self.slug}' already exists at {self.root}")
        self.ensure_dirs()
        state = State(
            slug=self.slug,
            concept=concept,
            created_at=datetime.utcnow(),
            config=config or ProjectConfig(),
        )
        self.save_state(state)
        return state

    # ---- plan ----
    def load_plan(self) -> Plan:
        return Plan.model_validate_json(self.plan_path.read_text())

    def save_plan(self, plan: Plan) -> None:
        _atomic_write_text(self.plan_path, plan.model_dump_json(indent=2))

    # ---- manifests ----
    def load_image_manifest(self) -> ImageManifest:
        if not self.image_manifest_path.exists():
            return ImageManifest()
        return ImageManifest.model_validate_json(self.image_manifest_path.read_text())

    def save_image_manifest(self, manifest: ImageManifest) -> None:
        _atomic_write_text(self.image_manifest_path, manifest.model_dump_json(indent=2))

    def load_clip_manifest(self) -> ClipManifest:
        if not self.clip_manifest_path.exists():
            return ClipManifest()
        return ClipManifest.model_validate_json(self.clip_manifest_path.read_text())

    def save_clip_manifest(self, manifest: ClipManifest) -> None:
        _atomic_write_text(self.clip_manifest_path, manifest.model_dump_json(indent=2))


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
