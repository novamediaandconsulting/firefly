// Types mirror src/firefly/schemas.py pydantic models. Keep in sync when
// editing the Python schemas — there's no codegen yet.

export type StageStatus =
  | "pending"
  | "in_progress"
  | "awaiting_qa"
  | "done"
  | "failed";

export interface StageState {
  status: StageStatus;
  completed_at: string | null;
  artifact: string | null;
  error: string | null;
}

export interface ProjectConfig {
  target_duration_minutes: number;
  resolution: string;
  plan_model: string;
  metadata_model: string;
  image_model: string;
  video_model: string;
  music_model: string;
  music_duration_s: number;
  clip_duration_s: number;
}

export interface JobStatus {
  stage: string;        // "images" | "clips" | "sfx" | "music" | "render"
  message: string;
  started_at: string;
  error: string | null;
}

export interface State {
  slug: string;
  concept: string;
  created_at: string;
  config: ProjectConfig;
  stages: Record<string, StageState>;
  current_job: JobStatus | null;
}

/** Response from any generation endpoint that runs in the background. */
export interface JobStartedResponse {
  status: "started";
  job: JobStatus;
}

export interface ProjectSummary {
  slug: string;
  concept: string;
  created_at: string;
  target_duration_minutes: number;
  resolution: string;
  stage_progress: Record<string, string>;
}

export interface SFXLayer {
  name: string;
  prompt: string;
  gain_db: number;
}

export interface Plan {
  working_title: string;
  visual_description: string;
  image_prompts: string[];
  clip_prompts: string[];
  motion_elements: string[];
  lighting: string;
  camera: string;
  music_mood: string;
  sfx_layers: SFXLayer[];
}

export interface ImageItem {
  id: string;
  filename: string;
  prompt: string;
  seed: number | null;
  approved: boolean;
}

export interface ImageManifest {
  items: ImageItem[];
}

export interface GalleryImage {
  filename: string;
  path: string;
  base_id: string;
  is_current: boolean;
  timestamp: number | null;
  prompt: string;
  approved: boolean;
}

export interface GalleryGroup {
  base_id: string;
  items: GalleryImage[];
}

export interface ImageGalleryResponse {
  groups: GalleryGroup[];
  extras: GalleryImage[];
}

export interface ClipItem {
  id: string;
  image_id: string;
  filename: string;
  prompt: string;
  duration_s: number;
  approved: boolean;
}

export interface ClipManifest {
  items: ClipItem[];
}

export interface MixConfig {
  layer_gains: Record<string, number>;
  disabled_layers: string[];
  use_music: boolean;
}

export interface VariationFile {
  id: string; // "v1", "v2", "v3"
  path: string;
}

export interface SfxLayerState {
  name: string;
  prompt: string;
  gain_db: number;
  canonical_path: string | null;
  current_variation: string | null;
  variations: VariationFile[];
}

export interface SfxState {
  layers: SfxLayerState[];
}

export interface MusicState {
  music_mood: string;
  canonical_path: string | null;
  current_variation: string | null;
  variations: VariationFile[];
}

export interface FinalVariant {
  name: string;
  duration_min: number;
  audio_mode: string;
  mix_snapshot: Record<string, number>;
  mp4_path: string;
  bytes: number;
  created_at: string;
}

export interface FinalVariants {
  items: FinalVariant[];
}

export interface CostSummary {
  total_usd: number;
  by_stage: Record<string, number>;
  by_provider: Record<string, number>;
  entry_count: number;
}

export interface CreateProjectRequest {
  slug: string;
  concept: string;
  duration_min?: number;
  resolution?: string;
  plan_model?: string;
}
