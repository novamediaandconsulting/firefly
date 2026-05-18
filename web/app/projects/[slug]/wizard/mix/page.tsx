"use client";

import { use, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { WizardLayout } from "@/components/wizard-layout";
import { PickedImageAnchor } from "@/components/picked-image-anchor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

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
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [previewVersion, setPreviewVersion] = useState(0);
  const initialized = useRef(false);

  // Initialize from plan + saved mix.
  useEffect(() => {
    if (!planQ.data || initialized.current) return;
    const initialGains: Record<string, number> = {};
    const initialDisabled = new Set<string>(mixQ.data?.disabled_layers ?? []);
    if (mixQ.data?.use_music !== false) {
      initialGains[MUSIC_KEY] = mixQ.data?.layer_gains?.[MUSIC_KEY] ?? 0;
    }
    for (const sfx of planQ.data.sfx_layers) {
      initialGains[sfx.name] =
        mixQ.data?.layer_gains?.[sfx.name] ?? sfx.gain_db;
    }
    setGains(initialGains);
    setDisabled(initialDisabled);
    initialized.current = true;
  }, [planQ.data, mixQ.data]);

  const preview = useMutation({
    mutationFn: () =>
      api.mixPreview(slug, gains, Array.from(disabled), 60),
    onSuccess: () => setPreviewVersion((v) => v + 1),
    onError: (e: Error) => toast.error(e.message),
  });

  const lock = useMutation({
    mutationFn: () =>
      api.lockMix(slug, {
        layer_gains: gains,
        disabled_layers: Array.from(disabled),
        use_music: mixQ.data?.use_music ?? true,
      }),
    onSuccess: () => {
      toast.success("Mix locked");
      queryClient.invalidateQueries({ queryKey: ["mix", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Debounced auto-preview when sliders / checkboxes change.
  useEffect(() => {
    if (!initialized.current) return;
    const timer = setTimeout(() => {
      // skip if all layers disabled
      const anyEnabled = Object.keys(gains).some((k) => !disabled.has(k));
      if (!anyEnabled) return;
      preview.mutate();
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gains, disabled]);

  const useMusic = mixQ.data?.use_music !== false;
  const sfxLayers = planQ.data?.sfx_layers ?? [];

  function toggleDisabled(key: string) {
    setDisabled((d) => {
      const next = new Set(d);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function continueToFinal() {
    await lock.mutateAsync();
  }

  return (
    <WizardLayout
      slug={slug}
      step="mix"
      title="Mix"
      description="Balance the levels. Uncheck a layer to drop it from the mix entirely. Preview re-renders automatically half a second after you stop sliding."
      onContinue={continueToFinal}
      continueLabel={lock.isPending ? "Locking…" : "Lock mix & continue"}
      continueDisabled={lock.isPending}
    >
      <PickedImageAnchor slug={slug} />

      <Card>
        <CardContent className="py-6 space-y-6">
          {useMusic && (
            <GainSlider
              label="Music bed"
              hint="Generative instrumental"
              value={gains[MUSIC_KEY] ?? 0}
              disabled={disabled.has(MUSIC_KEY)}
              onToggle={() => toggleDisabled(MUSIC_KEY)}
              onChange={(v) => setGains((g) => ({ ...g, [MUSIC_KEY]: v }))}
            />
          )}
          {sfxLayers.map((sfx) => (
            <GainSlider
              key={sfx.name}
              label={sfx.name}
              hint={`plan default: ${sfx.gain_db}dB`}
              value={gains[sfx.name] ?? sfx.gain_db}
              disabled={disabled.has(sfx.name)}
              onToggle={() => toggleDisabled(sfx.name)}
              onChange={(v) => setGains((g) => ({ ...g, [sfx.name]: v }))}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">Live preview (60s)</span>
            {preview.isPending && (
              <span className="text-xs text-muted-foreground animate-pulse">
                rendering…
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => preview.mutate()}
              disabled={preview.isPending}
              className="ml-auto"
            >
              Re-render now
            </Button>
          </div>
          {previewVersion > 0 ? (
            <audio
              key={previewVersion}
              src={`${projectFileUrl(slug, "intermediate/mix_preview.mp3")}?v=${previewVersion}`}
              controls
              autoPlay
              className="w-full h-10"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Move a slider or toggle a layer — preview will render automatically.
            </p>
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
  disabled,
  onChange,
  onToggle,
}: {
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
  onToggle: () => void;
}) {
  return (
    <div className={`space-y-2 ${disabled ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-3">
        <Checkbox
          checked={!disabled}
          onCheckedChange={onToggle}
          aria-label={`Enable ${label}`}
        />
        <Label className="cursor-pointer flex-1" onClick={onToggle}>
          {label}
        </Label>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div className="flex items-center gap-4 pl-7">
        <Slider
          value={[value]}
          min={-30}
          max={6}
          step={0.5}
          onValueChange={(v) => onChange(v[0])}
          disabled={disabled}
          className="flex-1"
        />
        <span className="text-sm font-mono w-16 text-right">
          {value.toFixed(1)} dB
        </span>
      </div>
    </div>
  );
}
