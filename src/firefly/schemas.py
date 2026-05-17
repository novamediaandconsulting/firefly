from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field


class StageStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    AWAITING_QA = "awaiting_qa"
    DONE = "done"
    FAILED = "failed"


class SFXLayer(BaseModel):
    name: str
    prompt: str
    gain_db: float = 0.0


class Plan(BaseModel):
    working_title: str
    visual_description: str
    image_prompt: str
    clip_prompts: list[str] = Field(min_length=1)
    motion_elements: list[str]
    lighting: str
    camera: str
    music_mood: str
    sfx_layers: list[SFXLayer]


class ImageItem(BaseModel):
    id: str
    filename: str
    prompt: str
    seed: int | None = None
    approved: bool = False


class ImageManifest(BaseModel):
    items: list[ImageItem] = []


class ClipItem(BaseModel):
    id: str
    image_id: str
    filename: str
    prompt: str
    duration_s: float
    approved: bool = False


class ClipManifest(BaseModel):
    items: list[ClipItem] = []


class StageState(BaseModel):
    status: StageStatus = StageStatus.PENDING
    completed_at: datetime | None = None
    artifact: str | None = None
    error: str | None = None


class ProjectConfig(BaseModel):
    target_duration_minutes: int = 480
    resolution: str = "1080p"
    plan_model: str = "claude-sonnet-4-6"
    metadata_model: str = "claude-sonnet-4-6"
    image_model: str = "fal-ai/flux-pro/v1.1"
    video_model: str = "fal-ai/kling-video/v3/pro/image-to-video"
    music_model: str = "cassetteai/music-generator"
    music_duration_s: int = 180  # length of one generated bed; we loop to target


STAGE_NAMES = ("plan", "images", "clips", "loop", "audio", "mux", "metadata")


class State(BaseModel):
    slug: str
    concept: str
    created_at: datetime
    config: ProjectConfig = ProjectConfig()
    stages: dict[str, StageState] = Field(
        default_factory=lambda: {name: StageState() for name in STAGE_NAMES}
    )

    def stage(self, name: str) -> StageState:
        if name not in self.stages:
            self.stages[name] = StageState()
        return self.stages[name]
