// Types mirror src/firefly/studio.py and src/firefly/api/routes/studio.py.
// Keep in sync when editing the Python schema — no codegen.

export interface JobStatus {
  stage: string;
  message: string;
  started_at: string;
  error: string | null;
}

export interface JobStartedResponse {
  status: "started";
  job: JobStatus;
}

export interface Attempt {
  id: string;                  // "v1", "v2", ...
  filename: string;            // relative to project root
  prompt: string;
  config: Record<string, unknown>;
  created_at: string;
  cost_usd: number;
}

export interface ImageStep {
  prompt: string;
  resolution: string;          // "720p" | "1080p" | "4k"
  attempts: Attempt[];
  chosen_attempt_id: string | null;
  confirmed: boolean;
}

export interface ClipStep {
  motion_prompts: string[];
  duration_s: number;          // 1..30
  loop_xfade_s: number;        // 0.5..10.0 — crossfade window at the loop boundary
  attempts: Attempt[];
  chosen_attempt_id: string | null;
  confirmed: boolean;
}

export interface SfxLayer {
  layer_id: string;
  title: string;
  prompt: string;
  gain_db: number;
  enabled_in_mix: boolean;
  attempts: Attempt[];
  chosen_attempt_id: string | null;
  deleted: boolean;
}

export interface SfxStep {
  layers: SfxLayer[];
  confirmed: boolean;
}

export interface MusicStep {
  prompt: string;
  skipped: boolean;
  attempts: Attempt[];
  chosen_attempt_id: string | null;
  confirmed: boolean;
}

export interface MixStep {
  layer_gains: Record<string, number>;   // keyed by layer_id or "_music"
  disabled_layers: string[];
  preview_duration_s: number;
  previews: Attempt[];
  confirmed: boolean;
}

export interface FinalRender {
  id: string;
  variant_name: string;
  duration_min: number;
  filename: string;
  bytes: number;
  created_at: string;
}

export interface FinalStep {
  duration_min: number;
  renders: FinalRender[];
  chosen_render_id: string | null;
  completed_at: string | null;
}

export interface StudioConfig {
  image_model: string;
  video_model: string;
  music_model: string;
  music_duration_s: number;
  plan_model: string;
}

export interface StudioProject {
  slug: string;
  title: string;
  created_at: string;
  last_modified_at: string;
  config: StudioConfig;
  image: ImageStep;
  clip: ClipStep;
  sfx: SfxStep;
  music: MusicStep;
  mix: MixStep;
  final: FinalStep;
  current_job: JobStatus | null;
  legacy: boolean;
}

// Trimmed view returned by GET /api/projects (the gallery).
export interface ProjectSummary {
  slug: string;
  title: string;
  created_at: string;
  last_modified_at: string;
  legacy: boolean;
  thumbnail_path: string | null;
  completed: boolean;
  current_step: "title" | "image" | "clip" | "sfx" | "music" | "mix" | "final" | "done";
}

export interface SlugPreview {
  raw_slug: string;
  final_slug: string;
  conflict: boolean;
}

export interface CostByStep {
  by_step: Record<string, number>;
  total_usd: number;
}

export interface CostSummary {
  total_usd: number;
  by_stage: Record<string, number>;
  by_provider: Record<string, number>;
  entry_count: number;
}
