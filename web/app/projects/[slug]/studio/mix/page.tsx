"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { StudioShell } from "@/components/studio-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { StudioProject } from "@/lib/types";

const MUSIC_KEY = "_music";

interface MixLayer {
  key: string;       // layer_id or MUSIC_KEY
  title: string;
  url: string;       // /files/.../...
  defaultGain: number;
}

export default function MixStepPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();
  const projectQ = useQuery({
    queryKey: ["project", slug],
    queryFn: () => api.getProject(slug),
    retry: false,
    refetchInterval: (q) => {
      const data = q.state.data as StudioProject | undefined;
      return data?.current_job && !data.current_job.error ? 2000 : false;
    },
  });
  const project = projectQ.data;

  // Build the mix layers — music (if present) + each non-deleted, chosen SFX.
  const mixLayers: MixLayer[] = useMemo(() => {
    if (!project) return [];
    const list: MixLayer[] = [];
    if (!project.music.skipped && project.music.chosen_attempt_id) {
      const a = project.music.attempts.find((x) => x.id === project.music.chosen_attempt_id);
      if (a) list.push({
        key: MUSIC_KEY, title: "Music bed",
        url: projectFileUrl(slug, a.filename),
        defaultGain: 0.0,
      });
    }
    for (const layer of project.sfx.layers) {
      if (layer.deleted) continue;
      if (!layer.chosen_attempt_id) continue;
      const a = layer.attempts.find((x) => x.id === layer.chosen_attempt_id);
      if (!a) continue;
      list.push({
        key: layer.layer_id,
        title: layer.title,
        url: projectFileUrl(slug, a.filename),
        defaultGain: layer.gain_db,
      });
    }
    return list;
  }, [project, slug]);

  // Local mix state — drives Web Audio and gets persisted to server.
  const [gains, setGains] = useState<Record<string, number>>({});
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [previewDuration, setPreviewDuration] = useState(60);
  const initialized = useRef(false);

  useEffect(() => {
    if (!project || !mixLayers.length || initialized.current) return;
    const initGains: Record<string, number> = {};
    const initDisabled = new Set<string>(project.mix.disabled_layers);
    for (const layer of mixLayers) {
      initGains[layer.key] = project.mix.layer_gains[layer.key] ?? layer.defaultGain;
    }
    setGains(initGains);
    setDisabled(initDisabled);
    setPreviewDuration(project.mix.preview_duration_s || 60);
    initialized.current = true;
  }, [project, mixLayers]);

  // ----- Web Audio: real-time mix playback -----
  const ctxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingBuffers, setLoadingBuffers] = useState(false);

  // Preload buffers when mix layers change.
  useEffect(() => {
    if (mixLayers.length === 0) return;
    if (!ctxRef.current) {
      // Construct lazily; AudioContext requires user gesture to resume.
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new Ctx();
    }
    setLoadingBuffers(true);
    Promise.all(
      mixLayers
        .filter((l) => !buffersRef.current.has(l.url))
        .map(async (l) => {
          const resp = await fetch(l.url);
          const arr = await resp.arrayBuffer();
          const buf = await ctxRef.current!.decodeAudioData(arr);
          buffersRef.current.set(l.url, buf);
        }),
    )
      .catch((e) => toast.error(`audio load failed: ${(e as Error).message}`))
      .finally(() => setLoadingBuffers(false));
  }, [mixLayers]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopAll();
      ctxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAll = useCallback(() => {
    for (const s of sourcesRef.current.values()) {
      try { s.stop(); } catch {/* already stopped */}
    }
    sourcesRef.current.clear();
    gainNodesRef.current.clear();
    setIsPlaying(false);
  }, []);

  const startAll = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume();
    stopAll(); // ensure clean state
    for (const layer of mixLayers) {
      if (disabled.has(layer.key)) continue;
      const buf = buffersRef.current.get(layer.url);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gainNode = ctx.createGain();
      gainNode.gain.value = dbToGain(gains[layer.key] ?? layer.defaultGain);
      src.connect(gainNode).connect(ctx.destination);
      src.start();
      sourcesRef.current.set(layer.key, src);
      gainNodesRef.current.set(layer.key, gainNode);
    }
    setIsPlaying(true);
  }, [mixLayers, gains, disabled, stopAll]);

  // Update gain in real time as slider moves.
  useEffect(() => {
    for (const [key, node] of gainNodesRef.current) {
      const value = disabled.has(key) ? 0 : dbToGain(gains[key] ?? 0);
      // Quick ramp for click-free transition.
      const ctx = ctxRef.current;
      if (ctx) {
        node.gain.setTargetAtTime(value, ctx.currentTime, 0.02);
      } else {
        node.gain.value = value;
      }
    }
  }, [gains, disabled]);

  // Persist mix state to server (debounced).
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!initialized.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.mixUpdate(slug, gains, Array.from(disabled), previewDuration).catch((e) =>
        toast.error(`mix save failed: ${(e as Error).message}`),
      );
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [gains, disabled, previewDuration, slug]);

  // ----- Exact (server-rendered) preview -----
  const isRendering =
    project?.current_job?.stage === "mix" && !project.current_job.error;
  const renderPreview = useMutation({
    mutationFn: async () => {
      // Save mix first so the server uses the latest values.
      await api.mixUpdate(slug, gains, Array.from(disabled), previewDuration);
      return api.mixPreview(slug, previewDuration);
    },
    onSuccess: () => {
      toast.success("Preview rendering");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const latestPreview = project?.mix.previews.at(-1) ?? null;

  async function confirm() {
    await api.mixUpdate(slug, gains, Array.from(disabled), previewDuration);
    await api.mixConfirm(slug);
    queryClient.invalidateQueries({ queryKey: ["project", slug] });
  }

  if (!project) {
    return <StudioShell slug={slug} step="mix" title="Mix" hideFooter>Loading…</StudioShell>;
  }
  if (mixLayers.length === 0) {
    return (
      <StudioShell slug={slug} step="mix" title="Mix" hideFooter>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No SFX layers or music to mix. Go back and add some — or skip ahead to the final step.
          </CardContent>
        </Card>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      slug={slug}
      step="mix"
      title="Mix"
      description="Balance the layers. The real-time preview uses your browser to play all sources at once — instant feedback. The exact preview renders the same ffmpeg path as the final."
      onContinue={confirm}
      continueLabel="Lock mix & continue"
    >
      <Card>
        <CardContent className="py-6 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base">Real-time mix</h2>
              <p className="text-xs text-muted-foreground">
                Plays all sources locally. Move sliders to hear the balance instantly.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {loadingBuffers && (
                <span className="text-xs text-muted-foreground">loading buffers…</span>
              )}
              <Button
                variant={isPlaying ? "secondary" : "default"}
                onClick={() => (isPlaying ? stopAll() : startAll())}
                disabled={loadingBuffers}
                size="lg"
              >
                {isPlaying ? "■ Stop" : "▶ Play"}
              </Button>
            </div>
          </div>

          {mixLayers.map((layer) => {
            const enabled = !disabled.has(layer.key);
            const value = gains[layer.key] ?? layer.defaultGain;
            return (
              <div key={layer.key} className={`space-y-2 ${!enabled ? "opacity-40" : ""}`}>
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={enabled}
                    onCheckedChange={(c) => {
                      setDisabled((d) => {
                        const next = new Set(d);
                        if (c) next.delete(layer.key);
                        else next.add(layer.key);
                        return next;
                      });
                    }}
                  />
                  <Label className="flex-1 cursor-pointer">{layer.title}</Label>
                  <span className="text-sm font-mono w-16 text-right">
                    {value.toFixed(1)} dB
                  </span>
                </div>
                <div className="pl-8">
                  <Slider
                    value={[value]}
                    min={-40}
                    max={6}
                    step={0.5}
                    onValueChange={(v) => setGains((g) => ({ ...g, [layer.key]: v[0] }))}
                    disabled={!enabled}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="prevdur">Exact preview length</Label>
              <p className="text-xs text-muted-foreground">
                Renders the same ffmpeg mix that the final video will use, at this
                length (5-300s). Slower than the real-time preview above but
                deterministic.
              </p>
            </div>
            <Input
              id="prevdur"
              type="number"
              min={5}
              max={300}
              value={previewDuration}
              onChange={(e) => setPreviewDuration(Math.max(5, Math.min(300, Number(e.target.value))))}
              className="w-24"
            />
            <Button onClick={() => renderPreview.mutate()} disabled={renderPreview.isPending || isRendering}>
              {isRendering ? "Rendering…" : "Render exact preview"}
            </Button>
          </div>
          {latestPreview && (
            <audio
              src={`${projectFileUrl(slug, latestPreview.filename)}?v=${latestPreview.id}`}
              controls
              className="w-full h-10"
              key={latestPreview.id}
            />
          )}
        </CardContent>
      </Card>
    </StudioShell>
  );
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
