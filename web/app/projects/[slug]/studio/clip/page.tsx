"use client";

import { use, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { StudioShell } from "@/components/studio-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { StudioProject } from "@/lib/types";

function estimateSeconds(durationS: number): [number, number] {
  // Kling v3 pro: ~6× clip duration empirically; chained pair takes ~2x.
  const base = durationS * 6;
  const upper = base * 1.5;
  return durationS > 15 ? [Math.round(base * 1.6), Math.round(upper * 1.6)] : [Math.round(base), Math.round(upper)];
}

// 1.0s → 10.0s in 0.5s steps (19 options)
const XFADE_OPTIONS = Array.from({ length: 19 }, (_, i) => 1.0 + i * 0.5);

export default function ClipStepPage({
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

  const [motionPrompts, setMotionPrompts] = useState<string[]>([""]);
  const [duration, setDuration] = useState(10);
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [xfadeS, setXfadeS] = useState(2.5);
  const [previewVersion, setPreviewVersion] = useState(0);
  // Captures the xfade value that was actually rendered into the current
  // clip_loop_preview.mp4. Used by the overlay to compute loop boundaries
  // correctly even if the user has since changed the dropdown without
  // re-rendering.
  const [lastPreviewedXfadeS, setLastPreviewedXfadeS] = useState(2.5);
  const [timeInIter, setTimeInIter] = useState<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // Init from project + auto-pick newest attempt.
  useEffect(() => {
    if (!project) return;
    if (motionPrompts.length === 1 && motionPrompts[0] === "" && project.clip.motion_prompts.length) {
      setMotionPrompts(project.clip.motion_prompts);
    }
    if (project.clip.duration_s) setDuration(project.clip.duration_s);
    if (project.clip.loop_xfade_s) setXfadeS(project.clip.loop_xfade_s);
    const latest = project.clip.attempts.at(-1);
    if (latest && latest.id !== activeAttemptId) setActiveAttemptId(latest.id);
    if (project.clip.attempts.length === 0) setActiveAttemptId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.clip.attempts.length, project?.clip.duration_s, project?.clip.loop_xfade_s]);

  const isClipJob =
    project?.current_job?.stage === "clip" && !project.current_job.error;
  const jobMsg = project?.current_job?.message ?? "";
  const isPreviewing = isClipJob && jobMsg.includes("loop preview");
  const isGenerating = isClipJob && !isPreviewing;

  // Bump preview cache-buster when a preview job finishes (was running, now isn't).
  const wasPreviewing = useRef(false);
  useEffect(() => {
    if (wasPreviewing.current && !isPreviewing) {
      setPreviewVersion(Date.now());
    }
    wasPreviewing.current = isPreviewing;
  }, [isPreviewing]);

  // Image anchor
  const imageAttempt = project?.image.attempts.find(
    (a) => a.id === project.image.chosen_attempt_id,
  );

  const generate = useMutation({
    mutationFn: () =>
      api.clipGenerate(
        slug,
        motionPrompts.map((p) => p.trim()).filter(Boolean),
        duration,
      ),
    onSuccess: () => {
      toast.success("Clip generation started");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost-by-step", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loopPreview = useMutation({
    mutationFn: () => api.clipLoopPreview(slug, xfadeS, 3),
    onSuccess: () => {
      setLastPreviewedXfadeS(xfadeS);
      toast.success(`Rendering loop preview @ ${xfadeS.toFixed(1)}s xfade`);
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function confirm() {
    if (!activeAttemptId) return;
    await api.clipSelect(slug, activeAttemptId);
    await api.clipConfirm(slug);
    queryClient.invalidateQueries({ queryKey: ["project", slug] });
  }

  function pickAttempt(id: string) {
    setActiveAttemptId(id);
    const a = project?.clip.attempts.find((x) => x.id === id);
    if (a) {
      const cfg = a.config as { motion_prompts?: string[]; duration_s?: number };
      if (cfg.motion_prompts) setMotionPrompts(cfg.motion_prompts.length ? cfg.motion_prompts : [""]);
      if (cfg.duration_s) setDuration(cfg.duration_s);
    }
  }

  const durationValid = duration >= 1 && duration <= 30;
  const canGenerate = durationValid && !isGenerating && !generate.isPending;
  const [estLow, estHigh] = estimateSeconds(duration);
  const activeAttempt = project?.clip.attempts.find((a) => a.id === activeAttemptId);

  // Drive the loop-boundary overlay off the video element's currentTime.
  // Each baked-in loop iteration lasts (clip_duration - xfade) seconds, and
  // the first `xfade` seconds of every iteration is the visible blend region.
  const previewClipDurationS =
    (activeAttempt?.config as { duration_s?: number } | undefined)?.duration_s ?? 0;
  const loopPeriodS = Math.max(0, previewClipDurationS - lastPreviewedXfadeS);
  useEffect(() => {
    if (previewVersion === 0 || loopPeriodS <= 0) return;
    let raf = 0;
    const tick = () => {
      const v = previewVideoRef.current;
      if (v && !Number.isNaN(v.currentTime)) {
        setTimeInIter(v.currentTime % loopPeriodS);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [previewVersion, loopPeriodS]);

  if (!project) {
    return <StudioShell slug={slug} step="clip" title="Clip" hideFooter>Loading…</StudioShell>;
  }
  if (!imageAttempt) {
    return (
      <StudioShell slug={slug} step="clip" title="Clip" hideFooter>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Confirm an image in the previous step first.
          </CardContent>
        </Card>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      slug={slug}
      step="clip"
      title="Clip"
      description="Describe the motion you want — fire flickering, snow falling, steam rising. The clip will loop the source motion in the final video."
      onContinue={confirm}
      continueLabel={activeAttempt ? "Confirm clip" : "Generate a clip first"}
      continueDisabled={!activeAttempt}
    >
      {/* Image anchor */}
      <Card>
        <CardContent className="p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={projectFileUrl(slug, imageAttempt.filename)}
            alt="confirmed scene"
            className="w-full rounded-md"
          />
          <div className="text-xs text-muted-foreground mt-2 line-clamp-2">
            {imageAttempt.prompt}
          </div>
        </CardContent>
      </Card>

      {/* Motion prompts editor */}
      <Card>
        <CardContent className="py-6 space-y-3">
          <div className="flex items-center justify-between">
            <Label>Motion prompts</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMotionPrompts([...motionPrompts, ""])}
            >
              + Add motion prompt
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Each prompt describes a thing in the image you want to move. Look at
            the picture above and describe motion for the elements you see.
          </p>
          {motionPrompts.map((p, i) => (
            <div key={i} className="flex gap-2">
              <Textarea
                rows={2}
                value={p}
                onChange={(e) => {
                  const next = [...motionPrompts];
                  next[i] = e.target.value;
                  setMotionPrompts(next);
                }}
                placeholder="e.g. snow falling steadily outside the tall arched windows"
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMotionPrompts(motionPrompts.filter((_, idx) => idx !== i))}
                disabled={motionPrompts.length <= 1}
              >
                ×
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Duration + generate */}
      <Card>
        <CardContent className="py-4 flex items-end gap-4">
          <div className="flex-1 space-y-2">
            <Label htmlFor="duration">Clip duration (seconds)</Label>
            <p className="text-xs text-muted-foreground">
              1–30s. Above 15s = chained 2-shot (motion stutters slightly at the seam).
              ~$1.12 per 10 seconds.
            </p>
          </div>
          <div className="space-y-1">
            <Input
              id="duration"
              type="number"
              min={1}
              max={30}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className={`w-24 text-base ${!durationValid ? "border-red-500" : ""}`}
            />
            {!durationValid && (
              <p className="text-xs text-red-600">must be 1–30</p>
            )}
          </div>
          <Button size="lg" onClick={() => generate.mutate()} disabled={!canGenerate}>
            {isGenerating
              ? "Generating…"
              : project.clip.attempts.length
              ? "Retry"
              : "Generate"}
          </Button>
        </CardContent>
      </Card>

      {/* Active clip */}
      {(isGenerating || activeAttempt) && (
        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="relative bg-black rounded-md overflow-hidden">
              {activeAttempt ? (
                <video
                  src={projectFileUrl(slug, activeAttempt.filename)}
                  controls
                  autoPlay
                  muted
                  loop
                  className="w-full aspect-video"
                  key={activeAttempt.id}
                />
              ) : (
                <div className="aspect-video flex items-center justify-center text-muted-foreground" />
              )}
              {isGenerating && (
                <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                  <div className="text-center space-y-2">
                    <div className="inline-block w-8 h-8 rounded-full bg-amber-500 shadow-[0_0_24px_rgba(245,158,11,0.6)] animate-pulse" />
                    <p className="font-semibold">Generating {duration}s clip…</p>
                    <p className="text-xs text-muted-foreground">
                      ~{estLow}–{estHigh} seconds {duration > 15 && "(chained 2-shot)"}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {activeAttempt && (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <span className="font-mono">
                    {activeAttempt.id} · {(activeAttempt.config as { duration_s?: number }).duration_s}s
                    {(activeAttempt.config as { chained?: boolean }).chained && " (chained)"}
                  </span>
                  <span>{new Date(activeAttempt.created_at).toLocaleString()}</span>
                </div>
                {(() => {
                  const used = (activeAttempt.config as { motion_prompts?: string[] }).motion_prompts ?? [];
                  if (used.length === 0) return null;
                  return (
                    <div className="border-t pt-3 px-1 space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">
                        Generated from {used.length} motion prompt{used.length === 1 ? "" : "s"}:
                      </div>
                      <ul className="space-y-1.5">
                        {used.map((p, i) => (
                          <li
                            key={i}
                            className="text-xs leading-relaxed bg-muted/40 rounded px-2.5 py-1.5"
                          >
                            <span className="text-muted-foreground font-mono mr-1.5">{i + 1}.</span>
                            {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loop preview — only meaningful once an attempt is selected */}
      {activeAttempt && (
        <Card>
          <CardContent className="py-5 space-y-4">
            <div className="space-y-1">
              <Label>Loop crossfade preview</Label>
              <p className="text-xs text-muted-foreground">
                The final render loops this clip many times to fill your target
                duration (e.g. a 10s clip → ~360 loops for a 60-minute video).
                The crossfade window blends the tail of each loop into its head
                so the boundary is invisible. Longer xfade = smoother loop but
                consumes more of the original clip&apos;s motion. Try a few values
                and preview to compare — the preview is 3 back-to-back loops so
                you see the boundary twice.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="xfade-select">Crossfade window</Label>
                <select
                  id="xfade-select"
                  value={xfadeS}
                  onChange={(e) => setXfadeS(Number(e.target.value))}
                  disabled={isClipJob}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                >
                  {XFADE_OPTIONS.map((v) => {
                    const tooLong =
                      activeAttempt &&
                      (activeAttempt.config as { duration_s?: number }).duration_s !== undefined &&
                      v * 2 >=
                        ((activeAttempt.config as { duration_s?: number }).duration_s as number);
                    return (
                      <option key={v} value={v} disabled={tooLong}>
                        {v.toFixed(1)}s
                        {v === 2.5 ? " (default)" : ""}
                        {tooLong ? " — too long for clip" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <Button
                size="lg"
                variant="outline"
                onClick={() => loopPreview.mutate()}
                disabled={isClipJob || loopPreview.isPending}
              >
                {isPreviewing ? "Rendering preview…" : "Preview loop"}
              </Button>
              <div className="text-xs text-muted-foreground self-center">
                Saved value: {project.clip.loop_xfade_s.toFixed(1)}s
              </div>
            </div>
            {previewVersion > 0 && !isPreviewing && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground flex items-center justify-between">
                  <span>Preview (3 back-to-back loops):</span>
                  <span className="font-mono">
                    iteration {loopPeriodS.toFixed(1)}s · xfade {lastPreviewedXfadeS.toFixed(1)}s
                  </span>
                </div>
                <div className="relative">
                  <video
                    key={previewVersion}
                    ref={previewVideoRef}
                    src={`${projectFileUrl(slug, "clip_loop_preview.mp4")}?v=${previewVersion}`}
                    controls
                    autoPlay
                    muted
                    loop
                    className="w-full rounded-md bg-black aspect-video"
                  />
                  {timeInIter !== null && loopPeriodS > 0 && (() => {
                    const inBlend = timeInIter < lastPreviewedXfadeS;
                    const blendLeft = lastPreviewedXfadeS - timeInIter;
                    const secondsToLoop = loopPeriodS - timeInIter;
                    return (
                      <div
                        className={`pointer-events-none absolute top-3 right-3 px-3 py-1.5 rounded-md font-mono text-xs font-semibold shadow-lg transition-colors ${
                          inBlend
                            ? "bg-amber-500/95 text-black"
                            : "bg-black/70 text-white backdrop-blur-sm"
                        }`}
                      >
                        {inBlend
                          ? `← BLEND · ${blendLeft.toFixed(1)}s left`
                          : `loop in ${secondsToLoop.toFixed(1)}s`}
                      </div>
                    );
                  })()}
                </div>
                <p className="text-xs text-muted-foreground">
                  White badge = steady playback (countdown to the next loop boundary).
                  Amber badge = inside the crossfade — this is where jankiness would
                  show. Look for ghosting, double-images, or sudden motion shifts.
                </p>
              </div>
            )}
            {isPreviewing && (
              <div className="rounded-md bg-muted/40 py-6 text-center text-sm text-muted-foreground">
                Rendering loop preview @ {xfadeS.toFixed(1)}s…
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* History strip */}
      {project.clip.attempts.length > 1 && (
        <div>
          <Label className="text-xs">History ({project.clip.attempts.length} attempts)</Label>
          <div className="flex gap-2 overflow-x-auto pb-2 mt-2">
            {project.clip.attempts.map((a) => {
              const active = a.id === activeAttemptId;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pickAttempt(a.id)}
                  className={`flex-shrink-0 rounded-md overflow-hidden border-2 ${
                    active ? "border-amber-500" : "border-transparent hover:border-foreground/30"
                  }`}
                  title={a.prompt}
                >
                  <video
                    src={projectFileUrl(slug, a.filename)}
                    muted
                    preload="metadata"
                    className="h-20 aspect-video object-cover bg-black"
                  />
                  <div className="text-[10px] font-mono text-center py-0.5">
                    {a.id} · {(a.config as { duration_s?: number }).duration_s}s
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </StudioShell>
  );
}
