"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import type { SFXLayer, SfxLayerState } from "@/lib/types";
import { WizardLayout } from "@/components/wizard-layout";
import { PickedImageAnchor } from "@/components/picked-image-anchor";
import { useJobPolling } from "@/lib/job-polling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SfxStep({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();
  const [variations, setVariations] = useState(3);
  const [editLayers, setEditLayers] = useState<SFXLayer[]>([]);
  const [dirty, setDirty] = useState(false);

  const sfxPollInterval = useJobPolling(slug, ["sfx"]);
  const planQ = useQuery({
    queryKey: ["plan", slug],
    queryFn: () => api.getPlan(slug),
    retry: false,
  });
  const sfxQ = useQuery({
    queryKey: ["sfx", slug],
    queryFn: () => api.getSfx(slug),
    retry: false,
    refetchInterval: sfxPollInterval,
  });
  const stateQ = useQuery({
    queryKey: ["project", slug],
    queryFn: () => api.getProject(slug),
    retry: false,
  });
  const isGenerating =
    stateQ.data?.current_job?.stage === "sfx" &&
    !stateQ.data.current_job.error;

  useEffect(() => {
    if (planQ.data) {
      setEditLayers(planQ.data.sfx_layers);
      setDirty(false);
    }
  }, [planQ.data]);

  const savePlan = useMutation({
    mutationFn: async () => {
      if (!planQ.data) throw new Error("no plan");
      return api.updatePlan(slug, {
        ...planQ.data,
        sfx_layers: editLayers,
      });
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["plan", slug] });
      queryClient.invalidateQueries({ queryKey: ["sfx", slug] });
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (dirty) await savePlan.mutateAsync();
      return api.generateSfx(slug, variations);
    },
    onSuccess: () => {
      toast.success("SFX variations ready");
      queryClient.invalidateQueries({ queryKey: ["sfx", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pick = useMutation({
    mutationFn: ({ layer, variation }: { layer: string; variation: string }) =>
      api.pickSfx(slug, layer, variation),
    onSuccess: () => {
      toast.success("Pick saved");
      queryClient.invalidateQueries({ queryKey: ["sfx", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const layerStates = sfxQ.data?.layers ?? [];
  const hasGenerated = layerStates.some((l) => l.variations.length > 0);
  const allPicked =
    layerStates.length > 0 &&
    layerStates.every(
      (l) => l.variations.length === 0 || l.current_variation,
    );

  function updateLayer(i: number, patch: Partial<SFXLayer>) {
    const next = [...editLayers];
    next[i] = { ...next[i], ...patch };
    setEditLayers(next);
    setDirty(true);
  }
  function addLayer() {
    setEditLayers([
      ...editLayers,
      { name: "New layer", prompt: "", gain_db: -14 },
    ]);
    setDirty(true);
  }
  function removeLayer(i: number) {
    setEditLayers(editLayers.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  return (
    <WizardLayout
      slug={slug}
      step="sfx"
      title="SFX layers"
      description="Define each ambient sound layer, then generate variations. Layers mix together; each gets its own gain."
      continueDisabled={!hasGenerated || !allPicked}
      continueLabel={
        !hasGenerated
          ? "Generate variations first"
          : !allPicked
          ? "Pick one per layer"
          : "Continue"
      }
    >
      <PickedImageAnchor slug={slug} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>SFX layers ({editLayers.length})</span>
            {dirty && (
              <span className="text-xs text-amber-600 font-normal">
                unsaved — saves on generate
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Each layer is generated separately as 3 takes. Gain is in dB —
            foreground sounds 0 to -6, background -14 to -18.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {editLayers.map((sfx, i) => {
            const state = layerStates.find((l) => l.name === sfx.name);
            return (
              <div key={i} className="rounded-md border p-3 space-y-3">
                <div className="grid grid-cols-12 gap-2 items-start">
                  <Input
                    className="col-span-3"
                    value={sfx.name}
                    onChange={(e) => updateLayer(i, { name: e.target.value })}
                    placeholder="Layer name"
                  />
                  <Textarea
                    rows={2}
                    className="col-span-7"
                    value={sfx.prompt}
                    onChange={(e) =>
                      updateLayer(i, { prompt: e.target.value })
                    }
                    placeholder="ElevenLabs prompt"
                  />
                  <Input
                    type="number"
                    className="col-span-1"
                    value={sfx.gain_db}
                    onChange={(e) =>
                      updateLayer(i, { gain_db: parseFloat(e.target.value) })
                    }
                    step={1}
                    title="gain dB"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="col-span-1"
                    onClick={() => removeLayer(i)}
                    disabled={editLayers.length <= 1}
                  >
                    ×
                  </Button>
                </div>
                {state && state.variations.length > 0 && (
                  <SfxVariations
                    slug={slug}
                    state={state}
                    onPick={(v) =>
                      pick.mutate({ layer: sfx.name, variation: v })
                    }
                  />
                )}
              </div>
            );
          })}
          <Button size="sm" variant="outline" onClick={addLayer}>
            + Add layer
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 flex items-center gap-4">
          <div className="flex-1">
            <Label htmlFor="variations" className="text-xs">
              Variations per layer
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              ~$0.05 per variation. Sticky — re-running only generates missing
              ones, so editing a layer&apos;s prompt and clicking generate
              creates new files only for that layer (after first deleting old).
            </p>
          </div>
          <Input
            id="variations"
            type="number"
            min={1}
            max={10}
            value={variations}
            onChange={(e) =>
              setVariations(Math.max(1, Math.min(10, Number(e.target.value))))
            }
            className="w-24"
          />
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || isGenerating}
          >
            {isGenerating ? "Generating…" : "Generate variations"}
          </Button>
        </CardContent>
      </Card>
    </WizardLayout>
  );
}

function SfxVariations({
  slug,
  state,
  onPick,
}: {
  slug: string;
  state: SfxLayerState;
  onPick: (variation: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {state.variations.map((v) => {
        const isPicked = state.current_variation === v.id;
        return (
          <div
            key={v.id}
            className={`rounded-md border p-2 space-y-2 ${
              isPicked ? "ring-2 ring-emerald-500 border-emerald-500" : ""
            }`}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono">{v.id}</span>
              {isPicked && <Badge>picked</Badge>}
            </div>
            <audio
              src={projectFileUrl(slug, v.path)}
              controls
              preload="none"
              className="w-full h-8"
            />
            <Button
              size="sm"
              variant={isPicked ? "secondary" : "outline"}
              onClick={() => onPick(v.id)}
              className="w-full"
            >
              {isPicked ? "Picked" : "Pick this"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
