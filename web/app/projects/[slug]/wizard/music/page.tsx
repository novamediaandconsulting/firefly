"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { WizardLayout } from "@/components/wizard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function MusicStep({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();
  const [variations, setVariations] = useState(3);

  const musicQ = useQuery({
    queryKey: ["music", slug],
    queryFn: () => api.getMusic(slug),
    retry: false,
  });
  const mixQ = useQuery({
    queryKey: ["mix", slug],
    queryFn: () => api.getMix(slug),
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => api.generateMusic(slug, variations),
    onSuccess: () => {
      toast.success("Music variations ready");
      queryClient.invalidateQueries({ queryKey: ["music", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pick = useMutation({
    mutationFn: (variation: string) => api.pickMusic(slug, variation),
    onSuccess: () => {
      toast.success("Pick saved");
      queryClient.invalidateQueries({ queryKey: ["music", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMix = useMutation({
    mutationFn: (useMusic: boolean) =>
      api.lockMix(slug, {
        layer_gains: mixQ.data?.layer_gains ?? {},
        disabled_layers: mixQ.data?.disabled_layers ?? [],
        use_music: useMusic,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mix", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const music = musicQ.data;
  const useMusic = mixQ.data?.use_music ?? true;
  const hasGenerated = (music?.variations.length ?? 0) > 0;

  return (
    <WizardLayout
      slug={slug}
      step="music"
      title="Music bed"
      description="A single 3-minute instrumental track gets looped under your video. Generate variations and pick the best mood — or skip music entirely for nature scenes."
      continueDisabled={useMusic && !hasGenerated}
      continueLabel={
        !useMusic
          ? "Continue (no music)"
          : hasGenerated
          ? "Continue"
          : "Generate variations first"
      }
    >
      <Card>
        <CardContent className="py-4 flex items-center gap-4">
          <div className="flex-1">
            <Label className="text-xs">Include music in this video?</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Mood from plan:{" "}
              <span className="text-foreground italic">
                {music?.music_mood || "—"}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={useMusic ? "default" : "outline"}
              size="sm"
              onClick={() => updateMix.mutate(true)}
            >
              Include
            </Button>
            <Button
              variant={!useMusic ? "default" : "outline"}
              size="sm"
              onClick={() => updateMix.mutate(false)}
            >
              Skip
            </Button>
          </div>
        </CardContent>
      </Card>

      {useMusic && (
        <>
          <Card>
            <CardContent className="py-4 flex items-center gap-4">
              <div className="flex-1">
                <Label htmlFor="variations" className="text-xs">
                  Variations
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  ~$0.06 per 3-min track (CassetteAI). Variations are sticky —
                  re-running only generates missing ones.
                </p>
              </div>
              <Input
                id="variations"
                type="number"
                min={1}
                max={10}
                value={variations}
                onChange={(e) =>
                  setVariations(
                    Math.max(1, Math.min(10, Number(e.target.value))),
                  )
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

          {music && music.variations.length > 0 && (
            <Card>
              <CardContent className="py-4 space-y-3">
                <Label>Pick a track</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {music.variations.map((v) => {
                    const isPicked = music.current_variation === v.id;
                    return (
                      <div
                        key={v.id}
                        className={`rounded-md border p-2 space-y-2 ${
                          isPicked
                            ? "ring-2 ring-emerald-500 border-emerald-500"
                            : ""
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
                          onClick={() => pick.mutate(v.id)}
                          className="w-full"
                        >
                          {isPicked ? "Picked" : "Pick this"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </WizardLayout>
  );
}
