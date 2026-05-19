// Studio step definitions used by the wizard navigation + redirect logic.

import type { StudioProject } from "./types";

export type StudioStepId =
  | "title"
  | "image"
  | "clip"
  | "sfx"
  | "music"
  | "mix"
  | "final";

export const STUDIO_STEPS: { id: StudioStepId; label: string }[] = [
  { id: "title",  label: "Title" },
  { id: "image",  label: "Image" },
  { id: "clip",   label: "Clip" },
  { id: "sfx",    label: "SFX" },
  { id: "music",  label: "Music" },
  { id: "mix",    label: "Mix" },
  { id: "final",  label: "Final" },
];

/** Returns the next step the user should work on. */
export function currentStep(p: StudioProject): StudioStepId {
  if (!p.image.confirmed) return "image";
  if (!p.clip.confirmed) return "clip";
  if (!p.sfx.confirmed) return "sfx";
  if (!p.music.confirmed) return "music";
  if (!p.mix.confirmed) return "mix";
  return "final";
}

export function isStepDone(p: StudioProject, step: StudioStepId): boolean {
  switch (step) {
    case "title":  return true;  // always done once project exists
    case "image":  return p.image.confirmed;
    case "clip":   return p.clip.confirmed;
    case "sfx":    return p.sfx.confirmed;
    case "music":  return p.music.confirmed;
    case "mix":    return p.mix.confirmed;
    case "final":  return p.final.completed_at !== null;
  }
}

export function stepIndex(id: StudioStepId): number {
  return STUDIO_STEPS.findIndex((s) => s.id === id);
}

export function nextStep(id: StudioStepId): StudioStepId | null {
  const i = stepIndex(id);
  return i >= 0 && i < STUDIO_STEPS.length - 1 ? STUDIO_STEPS[i + 1].id : null;
}

export function prevStep(id: StudioStepId): StudioStepId | null {
  const i = stepIndex(id);
  return i > 0 ? STUDIO_STEPS[i - 1].id : null;
}
