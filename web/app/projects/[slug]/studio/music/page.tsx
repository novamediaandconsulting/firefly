"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { StudioShell } from "@/components/studio-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { StudioProject } from "@/lib/types";

export default function MusicStepPage({
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

  const [prompt, setPrompt] = useState("");
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    if (project.music.prompt && prompt === "") setPrompt(project.music.prompt);
    const latest = project.music.attempts.at(-1);
    if (latest && latest.id !== activeAttemptId) setActiveAttemptId(latest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.music.attempts.length]);

  const isGenerating =
    project?.current_job?.stage === "music" && !project.current_job.error;

  const imageAttempt = project?.image.attempts.find(
    (a) => a.id === project.image.chosen_attempt_id,
  );

  const generate = useMutation({
    mutationFn: () => api.musicGenerate(slug, prompt.trim()),
    onSuccess: () => {
      toast.success("Music generation started");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost-by-step", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setModel = useMutation({
    mutationFn: (model: string) => api.musicSetModel(slug, model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const skip = useMutation({
    mutationFn: () => api.musicSkip(slug),
    onSuccess: () => {
      toast.success("Music skipped");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
  });

  async function confirm() {
    if (activeAttemptId && !project?.music.skipped) {
      await api.musicSelect(slug, activeAttemptId);
    }
    await api.musicConfirm(slug);
    queryClient.invalidateQueries({ queryKey: ["project", slug] });
  }

  function pickAttempt(id: string) {
    setActiveAttemptId(id);
    const a = project?.music.attempts.find((x) => x.id === id);
    if (a) setPrompt(a.prompt);
  }

  if (!project) {
    return <StudioShell slug={slug} step="music" title="Music" hideFooter>Loading…</StudioShell>;
  }

  const activeAttempt = project.music.attempts.find((a) => a.id === activeAttemptId);
  const sfxLayers = project.sfx.layers.filter((l) => !l.deleted);
  const canGenerate = prompt.trim().length > 3 && !isGenerating && !generate.isPending;
  const canConfirm = project.music.skipped || !!activeAttempt;

  return (
    <StudioShell
      slug={slug}
      step="music"
      title="Music bed"
      description="A single instrumental track plays under the whole video. Generate variations until you like one, or skip music entirely."
      onContinue={confirm}
      continueLabel={project.music.skipped ? "Continue (skipped)" : activeAttempt ? "Confirm music" : "Generate or skip"}
      continueDisabled={!canConfirm}
    >
      {/* Image + reminders */}
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
                <div className="text-muted-foreground font-semibold">Motion:</div>
                <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                  {project.clip.motion_prompts.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {sfxLayers.length > 0 && (
              <div className="text-xs space-y-1">
                <div className="text-muted-foreground font-semibold">SFX layers:</div>
                <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                  {sfxLayers.map((l) => (
                    <li key={l.layer_id}>{l.title}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="py-6 space-y-4">
          <div className="space-y-2">
            <Label>Music model</Label>
            <div className="flex gap-2">
              {[
                { id: "cassetteai/music-generator", label: "CassetteAI", hint: "fast (~15s), bright" },
                { id: "beatoven/music-generation",  label: "Beatoven",   hint: "tuned for ambient" },
              ].map((m) => {
                const active = (project.config.music_model || "cassetteai/music-generator") === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModel.mutate(m.id)}
                    disabled={setModel.isPending}
                    className={`flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-foreground"
                        : "border-border hover:border-foreground/30 text-muted-foreground"
                    }`}
                  >
                    <div className="font-semibold">{m.label}</div>
                    <div className="text-xs font-normal opacity-70">{m.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prompt">Music mood</Label>
            <Textarea
              id="prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Soft ambient piano with warm reverb, calm peaceful morning mood, slow tempo, no drums, no vocals"
            />
            <p className="text-xs text-muted-foreground">
              ~$0.06 per generation (3 min, looped to fill the video). Current model:{" "}
              <code className="font-mono">{project.config.music_model || "cassetteai/music-generator"}</code>.
            </p>
            {project.music.skipped && (
              <p className="text-xs text-amber-600">
                Music is currently set to skip. Click Generate to enable music.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => skip.mutate()}
              disabled={skip.isPending}
            >
              {project.music.skipped ? "✓ Music skipped" : "Skip music"}
            </Button>
            <Button onClick={() => generate.mutate()} disabled={!canGenerate} size="lg">
              {isGenerating
                ? "Generating…"
                : project.music.attempts.length
                ? "Regenerate"
                : "Generate"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(isGenerating || activeAttempt) && !project.music.skipped && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="relative">
              {activeAttempt && (
                <audio
                  src={projectFileUrl(slug, activeAttempt.filename)}
                  controls
                  preload="none"
                  className="w-full h-12"
                  key={activeAttempt.id}
                />
              )}
              {isGenerating && !activeAttempt && (
                <div className="h-12 flex items-center justify-center text-sm text-muted-foreground space-x-3">
                  <span className="inline-block w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
                  <span>generating music bed (~10-30s)…</span>
                </div>
              )}
            </div>
            {activeAttempt && (
              <div className="text-xs text-muted-foreground font-mono px-1">
                {activeAttempt.id} · {new Date(activeAttempt.created_at).toLocaleString()}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {project.music.attempts.length > 1 && (
        <div>
          <Label className="text-xs">History ({project.music.attempts.length} attempts)</Label>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {project.music.attempts.map((a) => {
              const active = a.id === activeAttemptId;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pickAttempt(a.id)}
                  className={`text-xs px-3 py-1.5 rounded font-mono ${
                    active
                      ? "bg-amber-500 text-white font-bold"
                      : "bg-muted text-muted-foreground hover:bg-foreground/20"
                  }`}
                  title={a.prompt}
                >
                  {a.id}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </StudioShell>
  );
}
