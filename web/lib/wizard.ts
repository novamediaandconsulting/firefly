// Wizard step definitions used by the create flow.
// Order here is the order the user moves through.

import type { State } from "./types";

export type WizardStepId =
  | "plan"
  | "images"
  | "clips"
  | "sfx"
  | "music"
  | "mix"
  | "final";

export interface WizardStep {
  id: WizardStepId;
  label: string;
  // Returns "done" | "current" | "pending" given project state + the active step.
}

export const WIZARD_STEPS: { id: WizardStepId; label: string }[] = [
  { id: "plan",   label: "Plan" },
  { id: "images", label: "Images" },
  { id: "clips",  label: "Clips" },
  { id: "sfx",    label: "SFX" },
  { id: "music",  label: "Music" },
  { id: "mix",    label: "Mix" },
  { id: "final",  label: "Final" },
];

/** Returns which wizard step the user should resume at, based on stage statuses. */
export function suggestStep(state: State): WizardStepId {
  const s = state.stages;
  if (s.plan?.status !== "done") return "plan";
  if (s.images?.status !== "done") return "images";
  if (s.clips?.status !== "done") return "clips";
  // SFX/music/mix all live under the audio stage; until we have richer
  // per-substage tracking, gate on audio + the existence of a locked mix.
  if (s.audio?.status !== "done") return "sfx";
  if (s.mux?.status !== "done") return "final";
  return "final";
}

export function stepIndex(id: WizardStepId): number {
  return WIZARD_STEPS.findIndex((s) => s.id === id);
}

export function nextStep(id: WizardStepId): WizardStepId | null {
  const i = stepIndex(id);
  return i >= 0 && i < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[i + 1].id : null;
}

export function prevStep(id: WizardStepId): WizardStepId | null {
  const i = stepIndex(id);
  return i > 0 ? WIZARD_STEPS[i - 1].id : null;
}
