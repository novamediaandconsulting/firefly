"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { StudioShell } from "@/components/studio-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StudioProject } from "@/lib/types";

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// Loop xfade dropdown options — must stay in sync with clip/page.tsx.
const XFADE_OPTIONS = Array.from({ length: 19 }, (_, i) => 1.0 + i * 0.5);

export default function FinalStepPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
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
  const [duration, setDuration] = useState(30);
  const [loopXfadeS, setLoopXfadeS] = useState(2.5);

  useEffect(() => {
    if (project?.final.duration_min) setDuration(project.final.duration_min);
  }, [project?.final.duration_min]);

  // Inherit the preference set on the clip step. Local override stays in
  // `loopXfadeS`; on render, server persists it back to project.clip if changed.
  useEffect(() => {
    if (project?.clip.loop_xfade_s) setLoopXfadeS(project.clip.loop_xfade_s);
  }, [project?.clip.loop_xfade_s]);

  const isRendering =
    project?.current_job?.stage === "render" && !project.current_job.error;

  const variantName = useMemo(() => `${slug}_${duration}min_${todayStamp()}`, [slug, duration]);

  const chosenClipAttempt = project?.clip.attempts.find(
    (a) => a.id === project.clip.chosen_attempt_id,
  );
  const chosenClipDurationS =
    (chosenClipAttempt?.config as { duration_s?: number } | undefined)?.duration_s;
  const xfadeChangedFromSaved =
    project?.clip.loop_xfade_s !== undefined &&
    loopXfadeS !== project.clip.loop_xfade_s;

  const render = useMutation({
    mutationFn: () => api.finalRender(slug, duration, loopXfadeS),
    onSuccess: () => {
      toast.success("Render started");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost-by-step", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const complete = useMutation({
    mutationFn: () => api.finalComplete(slug),
    onSuccess: () => {
      toast.success("Project completed");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!project) {
    return <StudioShell slug={slug} step="final" title="Final render" hideFooter>Loading…</StudioShell>;
  }

  const imageAttempt = project.image.attempts.find(
    (a) => a.id === project.image.chosen_attempt_id,
  );
  const latestRender = project.final.renders.at(-1) ?? null;
  const durationValid = duration >= 1 && duration <= 600;
  const sfxLayers = project.sfx.layers.filter((l) => !l.deleted);

  return (
    <StudioShell
      slug={slug}
      step="final"
      title="Final render"
      description="Choose the final video length and render. You can render multiple variants without redoing the earlier steps."
      onContinue={() => complete.mutate()}
      continueLabel={
        project.final.completed_at
          ? "✓ Completed"
          : !latestRender
          ? "Render a final first"
          : complete.isPending
          ? "Completing…"
          : "Complete project"
      }
      continueDisabled={!latestRender || complete.isPending}
    >
      {/* Summary card */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex gap-4">
            {imageAttempt && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={projectFileUrl(slug, imageAttempt.filename)}
                alt={project.title}
                className="w-48 aspect-video object-cover rounded-md flex-shrink-0"
              />
            )}
            <div className="flex-1 space-y-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground font-semibold">Title</div>
                <div className="text-lg font-bold">{project.title}</div>
              </div>
              {project.clip.motion_prompts.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground font-semibold">Motion</div>
                  <ul className="text-xs space-y-0.5 list-disc list-inside text-muted-foreground">
                    {project.clip.motion_prompts.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {sfxLayers.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground font-semibold">SFX</div>
                  <div className="text-xs text-muted-foreground">
                    {sfxLayers.map((l) => l.title).join(" · ")}
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs text-muted-foreground font-semibold">Music</div>
                <div className="text-xs text-muted-foreground italic">
                  {project.music.skipped ? "(no music)" : project.music.prompt || "—"}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Render controls */}
      <Card>
        <CardContent className="py-5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="duration">Final duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                min={1}
                max={600}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className={!durationValid ? "border-red-500" : ""}
              />
              <p className="text-xs text-muted-foreground">
                1–600 min. ffmpeg only — no API cost.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="loop-xfade">Loop crossfade</Label>
              <select
                id="loop-xfade"
                value={loopXfadeS}
                onChange={(e) => setLoopXfadeS(Number(e.target.value))}
                disabled={isRendering}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
              >
                {XFADE_OPTIONS.map((v) => {
                  const tooLong =
                    chosenClipDurationS !== undefined && v * 2 >= chosenClipDurationS;
                  return (
                    <option key={v} value={v} disabled={tooLong}>
                      {v.toFixed(1)}s
                      {v === 2.5 ? " (default)" : ""}
                      {tooLong ? " — too long for clip" : ""}
                    </option>
                  );
                })}
              </select>
              <p className="text-xs text-muted-foreground">
                {xfadeChangedFromSaved
                  ? `Overrides clip-step preference (${project.clip.loop_xfade_s.toFixed(1)}s)`
                  : "Inherited from clip step"}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Variant name</Label>
              <Input value={variantName} readOnly className="font-mono text-sm bg-muted" />
              <p className="text-xs text-muted-foreground">Auto-generated.</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              ~1 sec per minute of output for short videos; longer for 8hr+ renders.
            </span>
            <Button
              size="lg"
              onClick={() => render.mutate()}
              disabled={!durationValid || isRendering || render.isPending}
            >
              {isRendering
                ? "Rendering…"
                : project.final.renders.length
                ? "Render new variant"
                : "Render"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Latest render player */}
      {latestRender && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <video
              src={projectFileUrl(slug, latestRender.filename)}
              controls
              className="w-full rounded-md bg-black"
              key={latestRender.id}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span className="font-mono">
                {latestRender.variant_name} · {latestRender.duration_min}min · {(latestRender.bytes / 1024 / 1024).toFixed(0)} MB
                {latestRender.loop_xfade_s != null && ` · ${latestRender.loop_xfade_s.toFixed(1)}s xfade`}
              </span>
              <a
                href={projectFileUrl(slug, latestRender.filename)}
                target="_blank"
                rel="noopener"
                className="hover:text-foreground"
              >
                open ↗
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Render history */}
      {project.final.renders.length > 1 && (
        <div>
          <Label className="text-xs">All renders ({project.final.renders.length})</Label>
          <div className="space-y-2 mt-2">
            {project.final.renders
              .slice()
              .reverse()
              .map((r) => (
                <Card key={r.id} className="bg-muted/30">
                  <CardContent className="p-3 flex items-center justify-between gap-3 text-xs">
                    <div className="font-mono">
                      {r.variant_name} · {r.duration_min}min · {(r.bytes / 1024 / 1024).toFixed(0)} MB
                      {r.loop_xfade_s != null && ` · ${r.loop_xfade_s.toFixed(1)}s xfade`}
                    </div>
                    <a
                      href={projectFileUrl(slug, r.filename)}
                      target="_blank"
                      rel="noopener"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      open ↗
                    </a>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      )}
    </StudioShell>
  );
}
