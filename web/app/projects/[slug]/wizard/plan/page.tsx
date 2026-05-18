"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Plan, SFXLayer } from "@/lib/types";
import { WizardLayout } from "@/components/wizard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function PlanStep({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();
  const stateQ = useQuery({
    queryKey: ["project", slug],
    queryFn: () => api.getProject(slug),
  });
  const planQ = useQuery({
    queryKey: ["plan", slug],
    queryFn: () => api.getPlan(slug),
    enabled: stateQ.data?.stages.plan?.status === "done",
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => api.generatePlan(slug, false),
    onSuccess: () => {
      toast.success("Plan generated");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["plan", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (stateQ.isLoading) {
    return (
      <WizardLayout slug={slug} step="plan" title="Plan" hideFooter>
        Loading…
      </WizardLayout>
    );
  }

  if (!planQ.data) {
    return (
      <WizardLayout
        slug={slug}
        step="plan"
        title="Plan"
        description="Let Claude turn your concept into a structured scene plan."
        hideFooter
      >
        <Card>
          <CardContent className="py-10 text-center space-y-4">
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {stateQ.data?.concept}
            </p>
            <Button
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
            >
              {generate.isPending ? "Thinking…" : "Generate plan"}
            </Button>
          </CardContent>
        </Card>
      </WizardLayout>
    );
  }

  return (
    <PlanEditor
      slug={slug}
      initialPlan={planQ.data}
      onRegenerate={() => generate.mutate()}
      regenerating={generate.isPending}
    />
  );
}

interface PlanEditorProps {
  slug: string;
  initialPlan: Plan;
  onRegenerate: () => void;
  regenerating: boolean;
}

function PlanEditor({
  slug,
  initialPlan,
  onRegenerate,
  regenerating,
}: PlanEditorProps) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [dirty, setDirty] = useState(false);

  // Reset when initialPlan changes (e.g. after regenerate).
  useEffect(() => {
    setPlan(initialPlan);
    setDirty(false);
  }, [initialPlan]);

  const save = useMutation({
    mutationFn: () => api.updatePlan(slug, plan),
    onSuccess: () => {
      toast.success("Plan saved");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["plan", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function update<K extends keyof Plan>(key: K, value: Plan[K]) {
    setPlan((p) => ({ ...p, [key]: value }));
    setDirty(true);
  }

  function updateImagePrompt(i: number, value: string) {
    const next = [...plan.image_prompts];
    next[i] = value;
    update("image_prompts", next);
  }
  function addImagePrompt() {
    update("image_prompts", [...plan.image_prompts, ""]);
  }
  function removeImagePrompt(i: number) {
    update(
      "image_prompts",
      plan.image_prompts.filter((_, idx) => idx !== i),
    );
  }

  function updateSfx(i: number, patch: Partial<SFXLayer>) {
    const next = [...plan.sfx_layers];
    next[i] = { ...next[i], ...patch };
    update("sfx_layers", next);
  }
  function addSfx() {
    update("sfx_layers", [
      ...plan.sfx_layers,
      { name: "New layer", prompt: "", gain_db: -14 },
    ]);
  }
  function removeSfx(i: number) {
    update(
      "sfx_layers",
      plan.sfx_layers.filter((_, idx) => idx !== i),
    );
  }

  async function continueIfClean() {
    if (dirty) await save.mutateAsync();
  }

  return (
    <WizardLayout
      slug={slug}
      step="plan"
      title="Refine the plan"
      description="Edit anything Claude wrote before we start spending. You can add, remove, and reword prompts. Image prompts drive how varied your candidate images will be."
      onContinue={continueIfClean}
      continueLabel={dirty ? "Save & continue" : "Continue"}
      continueDisabled={save.isPending}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Working title:{" "}
          <span className="text-foreground font-medium">
            {plan.working_title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs text-amber-600">unsaved changes</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRegenerate}
            disabled={regenerating}
          >
            {regenerating ? "Regenerating…" : "↻ Regenerate from concept"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="space-y-2">
            <Label>Working title</Label>
            <Input
              value={plan.working_title}
              onChange={(e) => update("working_title", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Visual description</Label>
            <Textarea
              rows={3}
              value={plan.visual_description}
              onChange={(e) => update("visual_description", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Music mood</Label>
              <Input
                value={plan.music_mood}
                onChange={(e) => update("music_mood", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Camera</Label>
              <Input
                value={plan.camera}
                onChange={(e) => update("camera", e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Image prompts ({plan.image_prompts.length})</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Each image candidate uses one prompt from this list, cycling if
                you generate more candidates than prompts. Vary angle / framing /
                lighting between them.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={addImagePrompt}>
              + Add
            </Button>
          </div>
          {plan.image_prompts.map((prompt, i) => (
            <div key={i} className="flex gap-2">
              <Textarea
                rows={3}
                value={prompt}
                onChange={(e) => updateImagePrompt(i, e.target.value)}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeImagePrompt(i)}
                disabled={plan.image_prompts.length <= 1}
              >
                ×
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>SFX layers ({plan.sfx_layers.length})</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Each layer is generated separately and mixed at its gain.
                Foreground sounds around -6 to 0 dB; background ambience -14 to -18 dB.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={addSfx}>
              + Add
            </Button>
          </div>
          {plan.sfx_layers.map((sfx, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <Input
                className="col-span-3"
                value={sfx.name}
                onChange={(e) => updateSfx(i, { name: e.target.value })}
                placeholder="Layer name"
              />
              <Textarea
                rows={2}
                className="col-span-7"
                value={sfx.prompt}
                onChange={(e) => updateSfx(i, { prompt: e.target.value })}
                placeholder="ElevenLabs prompt"
              />
              <Input
                type="number"
                className="col-span-1"
                value={sfx.gain_db}
                onChange={(e) =>
                  updateSfx(i, { gain_db: parseFloat(e.target.value) })
                }
                step={1}
              />
              <Button
                variant="ghost"
                size="icon"
                className="col-span-1"
                onClick={() => removeSfx(i)}
                disabled={plan.sfx_layers.length <= 1}
              >
                ×
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex items-center justify-between">
            <Label>Clip prompts ({plan.clip_prompts.length})</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                update("clip_prompts", [...plan.clip_prompts, ""])
              }
            >
              + Add
            </Button>
          </div>
          {plan.clip_prompts.map((prompt, i) => (
            <div key={i} className="flex gap-2">
              <Textarea
                rows={2}
                value={prompt}
                onChange={(e) => {
                  const next = [...plan.clip_prompts];
                  next[i] = e.target.value;
                  update("clip_prompts", next);
                }}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  update(
                    "clip_prompts",
                    plan.clip_prompts.filter((_, idx) => idx !== i),
                  )
                }
                disabled={plan.clip_prompts.length <= 1}
              >
                ×
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {save.error && (
        <Alert variant="destructive">
          <AlertTitle>Save failed</AlertTitle>
          <AlertDescription>{(save.error as Error).message}</AlertDescription>
        </Alert>
      )}
    </WizardLayout>
  );
}
