"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { StudioShell } from "@/components/studio-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SfxLayer, StudioProject } from "@/lib/types";

export default function SfxStepPage({
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
  const [newLayerTitle, setNewLayerTitle] = useState("");

  const imageAttempt = project?.image.attempts.find(
    (a) => a.id === project.image.chosen_attempt_id,
  );

  const addLayer = useMutation({
    mutationFn: (title: string) => api.sfxAddLayer(slug, title),
    onSuccess: () => {
      toast.success("Layer added");
      setNewLayerTitle("");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function confirm() {
    await api.sfxConfirm(slug);
    queryClient.invalidateQueries({ queryKey: ["project", slug] });
  }

  if (!project) {
    return <StudioShell slug={slug} step="sfx" title="SFX" hideFooter>Loading…</StudioShell>;
  }

  const layers = project.sfx.layers.filter((l) => !l.deleted);

  return (
    <StudioShell
      slug={slug}
      step="sfx"
      title="Sound effects"
      description="Add ambient sound layers — fire crackle, wind, water, room tone. Each layer is generated on its own and mixed into the final audio."
      onContinue={confirm}
      continueLabel="Save & continue"
    >
      {/* Image + motion prompts reminder */}
      {imageAttempt && (
        <Card>
          <CardContent className="p-3 space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={projectFileUrl(slug, imageAttempt.filename)}
              alt="scene"
              className="w-full rounded-md"
            />
            {project.clip.motion_prompts.length > 0 && (
              <div className="text-xs space-y-1">
                <div className="text-muted-foreground font-semibold">Motion in the clip:</div>
                <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                  {project.clip.motion_prompts.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Layers */}
      {layers.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No SFX layers yet. Add one below — or continue with no sound effects.
          </CardContent>
        </Card>
      )}
      {layers.map((layer) => (
        <SfxLayerCard key={layer.layer_id} slug={slug} layer={layer} project={project} />
      ))}

      {/* Add layer */}
      <Card>
        <CardContent className="py-4 flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label htmlFor="newLayer">Add a sound effect layer</Label>
            <Input
              id="newLayer"
              value={newLayerTitle}
              onChange={(e) => setNewLayerTitle(e.target.value)}
              placeholder="e.g. Fireplace crackle"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newLayerTitle.trim()) {
                  addLayer.mutate(newLayerTitle.trim());
                }
              }}
            />
          </div>
          <Button
            onClick={() => addLayer.mutate(newLayerTitle.trim())}
            disabled={!newLayerTitle.trim() || addLayer.isPending}
          >
            {addLayer.isPending ? "Adding…" : "+ Add layer"}
          </Button>
        </CardContent>
      </Card>
    </StudioShell>
  );
}

function SfxLayerCard({
  slug,
  layer,
  project,
}: {
  slug: string;
  layer: SfxLayer;
  project: StudioProject;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(layer.title);
  const [prompt, setPrompt] = useState(layer.prompt);
  const [gain, setGain] = useState(layer.gain_db);
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(
    layer.chosen_attempt_id ?? layer.attempts.at(-1)?.id ?? null,
  );

  // Re-sync local state when server state changes (e.g. after polling).
  useEffect(() => {
    setTitle(layer.title);
    setPrompt(layer.prompt);
    setGain(layer.gain_db);
    const latest = layer.attempts.at(-1);
    if (latest && latest.id !== activeAttemptId) setActiveAttemptId(latest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.attempts.length, layer.title, layer.prompt, layer.gain_db]);

  const isGenerating =
    project.current_job?.stage === "sfx" && !project.current_job.error;

  const generate = useMutation({
    mutationFn: () =>
      api.sfxGenerate(slug, layer.layer_id, title.trim(), prompt.trim(), gain),
    onSuccess: () => {
      toast.success(`Generating ${title}…`);
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost-by-step", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const select = useMutation({
    mutationFn: (attemptId: string) => api.sfxSelect(slug, layer.layer_id, attemptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.sfxDeleteLayer(slug, layer.layer_id),
    onSuccess: () => {
      toast.success("Layer removed");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
  });

  function pickAttempt(id: string) {
    setActiveAttemptId(id);
    select.mutate(id);
    const a = layer.attempts.find((x) => x.id === id);
    if (a) {
      const cfg = a.config as { title?: string; gain_db?: number };
      if (cfg.title) setTitle(cfg.title);
      if (cfg.gain_db !== undefined) setGain(cfg.gain_db);
      setPrompt(a.prompt);
    }
  }

  const activeAttempt = layer.attempts.find((a) => a.id === activeAttemptId);
  const canGenerate = title.trim() && prompt.trim() && !isGenerating && !generate.isPending;

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-4 space-y-1">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fireplace crackle"
            />
          </div>
          <div className="col-span-6 space-y-1">
            <Label>Prompt</Label>
            <Textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="warm wood fireplace crackling, close perspective, loopable"
            />
          </div>
          <div className="col-span-1 space-y-1">
            <Label className="text-xs">Gain dB</Label>
            <Input
              type="number"
              value={gain}
              onChange={(e) => setGain(Number(e.target.value))}
              step={1}
            />
          </div>
          <div className="col-span-1 space-y-1 flex flex-col items-end justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => remove.mutate()}
              title="Delete layer"
            >
              ×
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button
            onClick={() => generate.mutate()}
            disabled={!canGenerate}
          >
            {isGenerating
              ? "Generating…"
              : layer.attempts.length
              ? "Regenerate"
              : "Generate"}
          </Button>
          <span className="text-xs text-muted-foreground">~$0.05 per 30-second clip</span>
        </div>

        {activeAttempt && (
          <div className="space-y-1">
            <audio
              src={projectFileUrl(slug, activeAttempt.filename)}
              controls
              preload="none"
              className="w-full h-10"
            />
            <div className="text-xs text-muted-foreground font-mono px-1">
              {activeAttempt.id} · {new Date(activeAttempt.created_at).toLocaleString()}
            </div>
          </div>
        )}

        {/* History */}
        {layer.attempts.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">history:</span>
            {layer.attempts.map((a) => {
              const active = a.id === activeAttemptId;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pickAttempt(a.id)}
                  className={`text-xs px-2 py-1 rounded font-mono ${
                    active
                      ? "bg-amber-500 text-white font-bold"
                      : "bg-muted text-muted-foreground hover:bg-foreground/20"
                  }`}
                >
                  {a.id}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
