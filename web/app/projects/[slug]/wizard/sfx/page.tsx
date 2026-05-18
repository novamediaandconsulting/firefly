"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import type { SfxLayerState } from "@/lib/types";
import { WizardLayout } from "@/components/wizard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SfxStep({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();
  const [variations, setVariations] = useState(3);

  const sfxQ = useQuery({
    queryKey: ["sfx", slug],
    queryFn: () => api.getSfx(slug),
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => api.generateSfx(slug, variations),
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

  const layers = sfxQ.data?.layers ?? [];
  const hasGenerated = layers.some((l) => l.variations.length > 0);
  const allPicked =
    layers.length > 0 &&
    layers.every((l) => l.variations.length === 0 || l.current_variation);

  return (
    <WizardLayout
      slug={slug}
      step="sfx"
      title="SFX layers"
      description="Each SFX layer is generated 3 times so you can pick the best take. Layers mix together for the final audio."
      continueDisabled={!hasGenerated || !allPicked}
      continueLabel={
        !hasGenerated
          ? "Generate variations first"
          : !allPicked
          ? "Pick one per layer"
          : "Continue"
      }
    >
      <Card>
        <CardContent className="py-4 flex items-center gap-4">
          <div className="flex-1">
            <Label htmlFor="variations" className="text-xs">
              Variations per layer
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              ~$0.05 per variation. {layers.length} layer(s) ×{" "}
              {variations} = {layers.length * variations} call(s) on first
              generation. Variations are sticky — re-running this only
              generates missing ones.
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
            disabled={generate.isPending}
          >
            {generate.isPending ? "Generating…" : "Generate variations"}
          </Button>
        </CardContent>
      </Card>

      {layers.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No SFX layers in the plan. Go back to Plan to add some.
        </p>
      )}

      {layers.map((layer) => (
        <SfxLayerCard
          key={layer.name}
          slug={slug}
          layer={layer}
          onPick={(variation) =>
            pick.mutate({ layer: layer.name, variation })
          }
        />
      ))}
    </WizardLayout>
  );
}

function SfxLayerCard({
  slug,
  layer,
  onPick,
}: {
  slug: string;
  layer: SfxLayerState;
  onPick: (variation: string) => void;
}) {
  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">{layer.name}</div>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              {layer.prompt}
            </p>
          </div>
          <Badge variant="secondary">{layer.gain_db}dB</Badge>
        </div>

        {layer.variations.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No variations yet — generate above.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {layer.variations.map((v) => {
              const isPicked = layer.current_variation === v.id;
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
                    src={projectFileUrl(slug, v.path.replace(/^.*?\//, ""))}
                    controls
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
        )}
      </CardContent>
    </Card>
  );
}
