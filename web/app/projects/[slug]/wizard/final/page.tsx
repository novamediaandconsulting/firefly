"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { WizardLayout } from "@/components/wizard-layout";
import { PickedImageAnchor } from "@/components/picked-image-anchor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default function FinalStep({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();
  const [variantName, setVariantName] = useState("30min");
  const [durationMin, setDurationMin] = useState(30);
  const [audioMode, setAudioMode] = useState("default");

  const variantsQ = useQuery({
    queryKey: ["variants", slug],
    queryFn: () => api.listVariants(slug),
    retry: false,
  });
  const mixQ = useQuery({
    queryKey: ["mix", slug],
    queryFn: () => api.getMix(slug),
    retry: false,
  });

  const render = useMutation({
    mutationFn: () =>
      api.render(slug, {
        variant: variantName.trim(),
        duration_min: durationMin,
        audio_mode: audioMode,
        force: false,
      }),
    onSuccess: () => {
      toast.success(`Rendered ${variantName}`);
      queryClient.invalidateQueries({ queryKey: ["variants", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // If mix.use_music is false, default audio_mode to "no-music".
  const suggestedMode = mixQ.data?.use_music === false ? "no-music" : "default";

  const variants = variantsQ.data?.items ?? [];

  return (
    <WizardLayout
      slug={slug}
      step="final"
      title="Render finals"
      description="Render one or more named MP4 variants. They share the same source files (same images, same clips, same audio) — only duration and audio mode change. No additional API spend."
      continueLabel="Done — back to project"
      onContinue={() => {}}
    >
      <PickedImageAnchor slug={slug} />

      <Card>
        <CardContent className="py-6 space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Variant name</Label>
              <Input
                id="name"
                value={variantName}
                onChange={(e) =>
                  setVariantName(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "_"),
                  )
                }
                placeholder="30min"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (min)</Label>
              <Input
                id="duration"
                type="number"
                min={1}
                max={480}
                value={durationMin}
                onChange={(e) =>
                  setDurationMin(
                    Math.max(1, Math.min(480, Number(e.target.value))),
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mode">Audio mode</Label>
              <select
                id="mode"
                value={audioMode}
                onChange={(e) => setAudioMode(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="default">default (music + SFX)</option>
                <option value="no-music">no-music (SFX only)</option>
                <option value="silent">silent</option>
                <option value="stock">stock music + SFX</option>
              </select>
            </div>
          </div>
          {suggestedMode !== audioMode && (
            <p className="text-xs text-amber-600">
              Mix is set to {suggestedMode === "no-music" ? "no music" : "include music"};
              consider matching audio mode.
            </p>
          )}
          <Button
            onClick={() => render.mutate()}
            disabled={render.isPending || !variantName.trim()}
          >
            {render.isPending
              ? "Rendering… (this can take a few minutes for long durations)"
              : `Render ${variantName}_${durationMin}min`}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-medium">Rendered variants</h2>
        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No variants yet — render your first one above.
          </p>
        ) : (
          variants
            .slice()
            .sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
            )
            .map((v) => (
              <Card key={v.name}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">{v.name}</div>
                      <div className="text-xs text-muted-foreground">
                        <Badge variant="secondary">{v.duration_min} min</Badge>{" "}
                        audio: {v.audio_mode} ·{" "}
                        {(v.bytes / (1024 * 1024)).toFixed(0)} MB ·{" "}
                        {new Date(v.created_at).toLocaleString()}
                      </div>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={projectFileUrl(slug, v.mp4_path)}
                        target="_blank"
                      >
                        Open
                      </a>
                    </Button>
                  </div>
                  <video
                    src={projectFileUrl(slug, v.mp4_path)}
                    controls
                    className="rounded-md w-full aspect-video bg-black"
                  />
                </CardContent>
              </Card>
            ))
        )}
      </div>
    </WizardLayout>
  );
}
