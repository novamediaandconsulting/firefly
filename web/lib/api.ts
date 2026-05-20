// Typed client for the Firefly Studio FastAPI service.
//
// All calls go through `request()` which throws Error(detail) on non-2xx.
// File URLs use the `/files/<slug>/...` static mount on the same backend.

import type {
  Attempt,
  CostByStep,
  CostSummary,
  JobStartedResponse,
  ProjectSummary,
  SlugPreview,
  StudioProject,
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

export const projectFileUrl = (slug: string, relPath: string): string =>
  `${API_BASE}/files/${slug}/${relPath}`;

export const api = {
  health: () => request<{ status: string }>("/api/health"),

  // ---- projects ----
  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  getProject: (slug: string) => request<StudioProject>(`/api/projects/${slug}`),
  createProject: (title: string) =>
    request<StudioProject>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  deleteProject: (slug: string) =>
    request<void>(`/api/projects/${slug}?confirm=true`, { method: "DELETE" }),
  clearJob: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/job`, { method: "DELETE" }),
  updateTitle: (slug: string, title: string) =>
    request<StudioProject>(`/api/projects/${slug}/title`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    }),
  slugPreview: (title: string) =>
    request<SlugPreview>(`/api/projects/slug-preview?title=${encodeURIComponent(title)}`),
  costByStep: (slug: string) =>
    request<CostByStep>(`/api/projects/${slug}/cost-by-step`),
  cost: (slug: string) => request<CostSummary>(`/api/projects/${slug}/cost`),

  // ---- image step ----
  imageGenerate: (slug: string, prompt: string, resolution: string) =>
    request<JobStartedResponse>(`/api/projects/${slug}/image/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt, resolution }),
    }),
  imageSelect: (slug: string, attemptId: string) =>
    request<Attempt>(`/api/projects/${slug}/image/select/${attemptId}`, { method: "POST" }),
  imageConfirm: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/image/confirm`, { method: "POST" }),
  imageUnconfirm: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/image/unconfirm`, { method: "POST" }),

  // ---- clip step ----
  clipGenerate: (slug: string, motionPrompts: string[], durationS: number) =>
    request<JobStartedResponse>(`/api/projects/${slug}/clip/generate`, {
      method: "POST",
      body: JSON.stringify({ motion_prompts: motionPrompts, duration_s: durationS }),
    }),
  clipSelect: (slug: string, attemptId: string) =>
    request<Attempt>(`/api/projects/${slug}/clip/select/${attemptId}`, { method: "POST" }),
  clipConfirm: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/clip/confirm`, { method: "POST" }),
  clipUnconfirm: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/clip/unconfirm`, { method: "POST" }),

  // ---- sfx step ----
  sfxAddLayer: (slug: string, title: string, prompt = "", gainDb = -12) =>
    request<StudioProject>(`/api/projects/${slug}/sfx/layers`, {
      method: "POST",
      body: JSON.stringify({ title, prompt, gain_db: gainDb }),
    }),
  sfxUpdateLayer: (
    slug: string,
    layerId: string,
    patch: { title?: string; prompt?: string; gain_db?: number; enabled_in_mix?: boolean },
  ) =>
    request<StudioProject>(`/api/projects/${slug}/sfx/layers/${layerId}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  sfxDeleteLayer: (slug: string, layerId: string) =>
    request<StudioProject>(`/api/projects/${slug}/sfx/layers/${layerId}`, {
      method: "DELETE",
    }),
  sfxGenerate: (slug: string, layerId: string, title: string, prompt: string, gainDb: number) =>
    request<JobStartedResponse>(
      `/api/projects/${slug}/sfx/layers/${layerId}/generate`,
      {
        method: "POST",
        body: JSON.stringify({ title, prompt, gain_db: gainDb }),
      },
    ),
  sfxSelect: (slug: string, layerId: string, attemptId: string) =>
    request<Attempt>(
      `/api/projects/${slug}/sfx/layers/${layerId}/select/${attemptId}`,
      { method: "POST" },
    ),
  sfxConfirm: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/sfx/confirm`, { method: "POST" }),
  sfxUnconfirm: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/sfx/unconfirm`, { method: "POST" }),

  // ---- music step ----
  musicGenerate: (slug: string, prompt: string) =>
    request<JobStartedResponse>(`/api/projects/${slug}/music/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  musicSetModel: (slug: string, model: string) =>
    request<StudioProject>(`/api/projects/${slug}/music/config`, {
      method: "PUT",
      body: JSON.stringify({ model }),
    }),
  musicSelect: (slug: string, attemptId: string) =>
    request<Attempt>(`/api/projects/${slug}/music/select/${attemptId}`, { method: "POST" }),
  musicSkip: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/music/skip`, { method: "POST" }),
  musicConfirm: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/music/confirm`, { method: "POST" }),
  musicUnconfirm: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/music/unconfirm`, { method: "POST" }),

  // ---- mix step ----
  mixUpdate: (
    slug: string,
    layerGains: Record<string, number>,
    disabledLayers: string[],
    previewDurationS?: number,
  ) =>
    request<StudioProject>(`/api/projects/${slug}/mix`, {
      method: "PUT",
      body: JSON.stringify({
        layer_gains: layerGains,
        disabled_layers: disabledLayers,
        preview_duration_s: previewDurationS ?? null,
      }),
    }),
  mixPreview: (slug: string, durationS: number) =>
    request<JobStartedResponse>(`/api/projects/${slug}/mix/preview`, {
      method: "POST",
      body: JSON.stringify({ duration_s: durationS }),
    }),
  mixConfirm: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/mix/confirm`, { method: "POST" }),
  mixUnconfirm: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/mix/unconfirm`, { method: "POST" }),

  // ---- final step ----
  finalUpdate: (slug: string, durationMin: number) =>
    request<StudioProject>(`/api/projects/${slug}/final`, {
      method: "PUT",
      body: JSON.stringify({ duration_min: durationMin }),
    }),
  finalRender: (slug: string, durationMin: number) =>
    request<JobStartedResponse>(`/api/projects/${slug}/final/render`, {
      method: "POST",
      body: JSON.stringify({ duration_min: durationMin }),
    }),
  finalComplete: (slug: string) =>
    request<StudioProject>(`/api/projects/${slug}/final/complete`, { method: "POST" }),
};
