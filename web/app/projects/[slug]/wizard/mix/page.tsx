"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { WizardLayout } from "@/components/wizard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

const MUSIC_KEY = "_music";

export default function MixStep({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();

  const planQ = useQuery({
    queryKey: ["plan", slug],
    queryFn: () => api.getPlan(slug),
    retry: false,
  });
  const mixQ = useQuery({
    queryKey: ["mix", slug],
    queryFn: () => api.getMix(slug),
    retry: false,
  });

  const [gains, setGains] = useState<Record<string, number>>({});
  const [previewKey, setPreviewKey] = useState(0);

  // Initialize gains from plan + mix.json overrides
  useEffect(() => {
    if (!planQ.data) return;
    const initial: Record<string, number> = {};
    if (mixQ.data?.use_music !== false) {
      initial[MUSIC_KEY] =
        mixQ.data?.layer_gains[MUSIC_KEY] ?? 0;
    }
    for (const sfx of planQ.data.sfx_layers) {
      initial[sfx.name] = mixQ.data?.layer_gains[sfx.name] ?? sfx.gain_db;
    }
    setGains(initial);
  }, [planQ.data, mixQ.data]);

  const preview = useMutation({
    mutationFn: () => api.mixPreview(slug, gains, 60),
    onSuccess: () => setPreviewKey((k) => k + 1),
    onError: (e: Error) => toast.error(e.message),
  });

  const lock = useMutation({
    mutationFn: () =>
      api.lockMix(slug, {
        layer_gains: gains,
        use_music: mixQ.data?.use_music ?? true,
      }),
    onSuccess: () => {
      toast.success("Mix locked");
      queryClient.invalidateQueries({ queryKey: ["mix", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const useMusic = mixQ.data?.use_music !== false;
  const sfxLayers = planQ.data?.sfx_layers ?? [];

  async function continueToFinal() {
    await lock.mutateAsync();
  }

  return (
    <WizardLayout
      slug={slug}
      step="mix"
      title="Mix"
      description="Set the relative levels of every layer. Each slider is in dB — 0 is unity gain, -infinity is muted."
      onContinue={continueToFinal}
      continueLabel={lock.isPending ? "Locking…" : "Lock mix & continue"}
      continueDisabled={lock.isPending}
    >
      <Card>
        <CardContent className="py-6 space-y-6">
          {useMusic && (
            <GainSlider
              label="Music bed"
              hint="Generative instrumental"
              value={gains[MUSIC_KEY] ?? 0}
              onChange={(v) =>
                setGains((g) => ({ ...g, [MUSIC_KEY]: v }))
              }
            />
          )}
          {sfxLayers.map((sfx) => (
            <GainSlider
              key={sfx.name}
              label={sfx.name}
              hint={`plan default: ${sfx.gain_db}dB`}
              value={gains[sfx.name] ?? sfx.gain_db}
              onChange={(v) =>
                setGains((g) => ({ ...g, [sfx.name]: v }))
              }
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 flex items-center gap-4">
          <Button
            onClick={() => preview.mutate()}
            disabled={preview.isPending}
          >
            {preview.isPending ? "Rendering preview…" : "Render 60s preview"}
          </Button>
          {preview.data && (
            <audio
              key={previewKey}
              src={projectFileUrl(slug, "intermediate/mix_preview.mp3")}
              controls
              autoPlay
              className="flex-1 h-10"
            />
          )}
        </CardContent>
      </Card>
    </WizardLayout>
  );
}

function GainSlider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div className="flex items-center gap-4">
        <Slider
          value={[value]}
          min={-30}
          max={6}
          step={0.5}
          onValueChange={(v) => onChange(v[0])}
          className="flex-1"
        />
        <span className="text-sm font-mono w-16 text-right">
          {value.toFixed(1)} dB
        </span>
      </div>
    </div>
  );
}
