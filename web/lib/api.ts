// Typed client for the firefly FastAPI service.
//
// All calls go through `request()` which throws Error(detail) on non-2xx.
// File URLs use the `/files/<slug>/...` static mount on the same backend.

import type {
  ClipManifest,
  CostSummary,
  CreateProjectRequest,
  FinalVariants,
  ImageManifest,
  MixConfig,
  MusicState,
  Plan,
  ProjectSummary,
  SfxState,
  State,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail: string;
    try {
      const body = await res.json();
      detail = body.detail ?? res.statusText;
    } catch {
      detail = res.statusText;
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const fileUrl = (relPath: string): string =>
  `${API_BASE}/files/${relPath}`;

export const projectFileUrl = (slug: string, relPath: string): string =>
  `${API_BASE}/files/${slug}/${relPath}`;

export const api = {
  health: () => request<{ status: string; projects_root: string }>("/api/health"),

  // ---- projects ----
  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  getProject: (slug: string) => request<State>(`/api/projects/${slug}`),
  createProject: (req: CreateProjectRequest) =>
    request<State>("/api/projects", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  deleteProject: (slug: string) =>
    request<void>(`/api/projects/${slug}?confirm=true`, { method: "DELETE" }),

  // ---- plan ----
  getPlan: (slug: string) => request<Plan>(`/api/projects/${slug}/plan`),
  generatePlan: (slug: string, force = false) =>
    request<Plan>(
      `/api/projects/${slug}/plan${force ? "?force=true" : ""}`,
      { method: "POST" },
    ),
  updatePlan: (slug: string, plan: Plan) =>
    request<Plan>(`/api/projects/${slug}/plan`, {
      method: "PUT",
      body: JSON.stringify(plan),
    }),

  // ---- images ----
  getImages: (slug: string) =>
    request<ImageManifest>(`/api/projects/${slug}/images`),
  generateImages: (slug: string, count = 4, force = false) =>
    request<ImageManifest>(`/api/projects/${slug}/images`, {
      method: "POST",
      body: JSON.stringify({ count, force }),
    }),
  approveImages: (slug: string, ids: string[]) =>
    request<ImageManifest>(`/api/projects/${slug}/images/approve`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  regenImage: (slug: string, imageId: string, prompt?: string) =>
    request<ImageManifest>(
      `/api/projects/${slug}/images/${imageId}/regen`,
      { method: "POST", body: JSON.stringify({ prompt: prompt ?? null }) },
    ),

  // ---- clips ----
  getClips: (slug: string) =>
    request<ClipManifest>(`/api/projects/${slug}/clips`),
  generateClips: (slug: string, perImage = 3, force = false) =>
    request<ClipManifest>(`/api/projects/${slug}/clips`, {
      method: "POST",
      body: JSON.stringify({ per_image: perImage, force }),
    }),
  approveClips: (slug: string, ids: string[]) =>
    request<ClipManifest>(`/api/projects/${slug}/clips/approve`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  unapproveClips: (slug: string, ids: string[]) =>
    request<ClipManifest>(`/api/projects/${slug}/clips/unapprove`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  unapproveImages: (slug: string, ids: string[]) =>
    request<ImageManifest>(`/api/projects/${slug}/images/unapprove`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  regenClip: (slug: string, clipId: string, prompt?: string) =>
    request<ClipManifest>(
      `/api/projects/${slug}/clips/${clipId}/regen`,
      { method: "POST", body: JSON.stringify({ prompt: prompt ?? null }) },
    ),
  buildLoop: (slug: string, durationMin?: number, force = false) =>
    request<{ video_track: string }>(
      `/api/projects/${slug}/clips/loop`,
      {
        method: "POST",
        body: JSON.stringify({ duration_min: durationMin ?? null, force }),
      },
    ),

  // ---- audio ----
  generateAudio: (
    slug: string,
    opts: {
      silent?: boolean;
      stock?: boolean;
      no_music?: boolean;
      skip_sfx?: boolean;
      sfx_variations?: number;
      music_variations?: number;
      force?: boolean;
    } = {},
  ) =>
    request<{ audio_track: string; preview: string }>(
      `/api/projects/${slug}/audio`,
      { method: "POST", body: JSON.stringify(opts) },
    ),
  // ---- sfx / music variations ----
  getSfx: (slug: string) => request<SfxState>(`/api/projects/${slug}/sfx`),
  generateSfx: (slug: string, variations = 3) =>
    request<SfxState>(`/api/projects/${slug}/sfx/generate`, {
      method: "POST",
      body: JSON.stringify({ variations }),
    }),
  getMusic: (slug: string) => request<MusicState>(`/api/projects/${slug}/music`),
  generateMusic: (slug: string, variations = 3) =>
    request<MusicState>(`/api/projects/${slug}/music/generate`, {
      method: "POST",
      body: JSON.stringify({ variations }),
    }),

  regenSfx: (slug: string, layerName: string, prompt?: string, variations = 3) =>
    request<{ status: string }>(
      `/api/projects/${slug}/sfx/${encodeURIComponent(layerName)}/regen`,
      {
        method: "POST",
        body: JSON.stringify({ prompt: prompt ?? null, variations }),
      },
    ),
  pickSfx: (slug: string, layerName: string, variation: string) =>
    request<{ status: string }>(
      `/api/projects/${slug}/sfx/${encodeURIComponent(layerName)}/pick`,
      { method: "POST", body: JSON.stringify({ variation }) },
    ),
  pickMusic: (slug: string, variation: string) =>
    request<{ status: string }>(`/api/projects/${slug}/music/pick`, {
      method: "POST",
      body: JSON.stringify({ variation }),
    }),
  runMux: (slug: string, force = false) =>
    request<{ final: string }>(`/api/projects/${slug}/mux`, {
      method: "POST",
      body: JSON.stringify({ force }),
    }),

  // ---- mix ----
  getMix: (slug: string) => request<MixConfig>(`/api/projects/${slug}/mix`),
  lockMix: (slug: string, mix: MixConfig) =>
    request<MixConfig>(`/api/projects/${slug}/mix`, {
      method: "PUT",
      body: JSON.stringify(mix),
    }),
  mixPreview: (
    slug: string,
    layerGains: Record<string, number>,
    disabledLayers: string[] = [],
    durationS = 60,
  ) =>
    request<{ preview: string }>(`/api/projects/${slug}/mix/preview`, {
      method: "POST",
      body: JSON.stringify({
        layer_gains: layerGains,
        disabled_layers: disabledLayers,
        duration_s: durationS,
      }),
    }),

  // ---- render / variants ----
  render: (
    slug: string,
    req: { variant: string; duration_min: number; audio_mode?: string; force?: boolean },
  ) =>
    request<{ final: string }>(`/api/projects/${slug}/render`, {
      method: "POST",
      body: JSON.stringify(req),
    }),
  listVariants: (slug: string) =>
    request<FinalVariants>(`/api/projects/${slug}/variants`),

  // ---- cost ----
  getCost: (slug: string) =>
    request<CostSummary>(`/api/projects/${slug}/cost`),
};
