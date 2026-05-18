from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field, model_validator


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
    # Multiple varied image prompts (different camera angle / composition / lighting
    # of the same scene). Candidates cycle through this list — different prompt =
    # visibly different image, not just a different fal seed of the same prompt.
    image_prompts: list[str] = Field(min_length=1)
    clip_prompts: list[str] = Field(min_length=1)
    motion_elements: list[str]
    lighting: str
    camera: str
    music_mood: str
    sfx_layers: list[SFXLayer]

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_image_prompt(cls, data):
        """Legacy plans had `image_prompt: str`. Wrap singletons into a list."""
        if isinstance(data, dict) and "image_prompt" in data and "image_prompts" not in data:
            data = dict(data)
            data["image_prompts"] = [data.pop("image_prompt")]
        return data


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
    clip_duration_s: int = 10    # length of each image-to-video clip


STAGE_NAMES = ("plan", "images", "clips", "loop", "audio", "mux", "metadata")

# Key used in MixConfig.layer_gains for the music bed (which has no SFX-style name).
MUSIC_GAIN_KEY = "_music"


class MixConfig(BaseModel):
    """Per-layer gain overrides for the final audio mix.

    Stored at `projects/<slug>/mix.json`. Layers without an entry use the gain
    defined in plan.sfx_layers (or 0.0 for music). The wizard's step 7 writes
    this file when the user locks the mix.

    `use_music` is set in step 6 (music) — if False, the music bed is excluded
    from the mix entirely (renders effectively in "no-music" audio_mode).
    """
    layer_gains: dict[str, float] = Field(default_factory=dict)
    use_music: bool = True

    def gain_for_sfx(self, sfx: "SFXLayer") -> float:
        return self.layer_gains.get(sfx.name, sfx.gain_db)

    def gain_for_music(self, default: float = 0.0) -> float:
        return self.layer_gains.get(MUSIC_GAIN_KEY, default)


class FinalVariant(BaseModel):
    """A named final render of the project (e.g. '30min', '8hr_no_music')."""
    name: str
    duration_min: int
    audio_mode: str = "default"  # "default" | "no-music" | "silent" | "stock"
    mix_snapshot: dict[str, float] = Field(default_factory=dict)
    mp4_path: str  # relative to project root
    bytes: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FinalVariants(BaseModel):
    items: list[FinalVariant] = Field(default_factory=list)


class CostEntry(BaseModel):
    """One billable provider call. Appended to projects/<slug>/costs.jsonl."""
    ts: datetime
    provider: str   # "fal", "anthropic", "elevenlabs"
    model: str      # exact model string / endpoint
    stage: str      # "plan" | "images" | "clips" | "audio" | "music" | ...
    artifact_id: str | None = None  # e.g. "img_01", "clip_002", "sfx_brook_v2"
    units: float    # e.g. 1 (per image), 5 (seconds of video), 180 (seconds of music)
    unit_name: str  # "image", "second", "request"
    cost_usd: float


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
