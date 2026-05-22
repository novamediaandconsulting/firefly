"use client";

import { use, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { StudioShell } from "@/components/studio-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StudioProject } from "@/lib/types";

const RESOLUTIONS = [
  { id: "720p",  label: "720p",  hint: "fast" },
  { id: "1080p", label: "1080p", hint: "default" },
  { id: "4k",    label: "4K",    hint: "upscaled" },
];

function estimateSeconds(resolution: string): [number, number] {
  return resolution === "4k" ? [15, 30] : [8, 20];
}

export default function ImageStepPage({
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
  const [resolution, setResolution] = useState("1080p");
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);

  // Remix tab state
  const [tab, setTab] = useState<"generate" | "remix">("generate");
  const [refPath, setRefPath] = useState<string | null>(null);
  const [remixPrompt, setRemixPrompt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Init from project + auto-jump to newest attempt as new ones land.
  useEffect(() => {
    if (!project) return;
    if (prompt === "" && project.image.prompt) setPrompt(project.image.prompt);
    setResolution(project.image.resolution || "1080p");
    const latest = project.image.attempts.at(-1);
    if (latest && latest.id !== activeAttemptId) {
      setActiveAttemptId(latest.id);
    }
    if (project.image.attempts.length === 0) {
      setActiveAttemptId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.image.attempts.length, project?.image.resolution]);

  const isGenerating =
    project?.current_job?.stage === "image" && !project.current_job.error;

  const generate = useMutation({
    mutationFn: () => api.imageGenerate(slug, prompt.trim(), resolution),
    onSuccess: () => {
      toast.success("Generation started");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost-by-step", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.imageUpload(slug, file),
    onSuccess: (r) => {
      setRefPath(r.ref_path);
      toast.success(`Uploaded ${(r.bytes / 1024).toFixed(0)} KB`);
    },
    onError: (e: Error) => toast.error(`Upload failed: ${e.message}`),
  });

  const remix = useMutation({
    mutationFn: () => {
      if (!refPath) throw new Error("upload a reference image first");
      return api.imageRemix(slug, refPath, remixPrompt.trim(), resolution);
    },
    onSuccess: () => {
      toast.success("Remix started");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost-by-step", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeAttempt = project?.image.attempts.find((a) => a.id === activeAttemptId);

  async function confirm() {
    if (!activeAttemptId) return;
    await api.imageSelect(slug, activeAttemptId);
    await api.imageConfirm(slug);
    queryClient.invalidateQueries({ queryKey: ["project", slug] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  }

  function pickAttempt(id: string) {
    setActiveAttemptId(id);
    const a = project?.image.attempts.find((x) => x.id === id);
    if (a) {
      const cfg = a.config as { resolution?: string; kind?: string; reference?: string };
      if (cfg.kind === "remix") {
        setTab("remix");
        setRemixPrompt(a.prompt);
        if (cfg.reference) setRefPath(cfg.reference);
      } else {
        setTab("generate");
        setPrompt(a.prompt);
      }
      if (cfg.resolution) setResolution(cfg.resolution);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) upload.mutate(f);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) upload.mutate(f);
  }

  const [estLow, estHigh] = estimateSeconds(resolution);
  const canGenerate = prompt.trim().length > 5 && !isGenerating && !generate.isPending;
  const canRemix = !!refPath && remixPrompt.trim().length > 5 && !isGenerating && !remix.isPending && !upload.isPending;

  return (
    <StudioShell
      slug={slug}
      step="image"
      title="Image"
      description="Generate from a description, or remix an image you upload. Retry as many times as you like; pick the one you want; confirm."
      onContinue={confirm}
      continueLabel={activeAttempt ? "Confirm image" : "Generate first"}
      continueDisabled={!activeAttempt}
    >
      <Card>
        <CardContent className="py-6 space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "generate" | "remix")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="generate">Generate</TabsTrigger>
              <TabsTrigger value="remix">Remix an upload</TabsTrigger>
            </TabsList>

            <TabsContent value="generate" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="prompt">Scene description</Label>
                <Textarea
                  id="prompt"
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="A cozy library at dusk with a crackling fireplace, deep leather armchairs, snow visible through tall arched windows…"
                  className="text-base"
                />
              </div>
              <ResolutionRadio value={resolution} onChange={setResolution} />
              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-muted-foreground">
                  ~$0.05 per image. Estimated: {estLow}–{estHigh}s.
                </div>
                <Button size="lg" onClick={() => generate.mutate()} disabled={!canGenerate}>
                  {isGenerating
                    ? "Generating…"
                    : project?.image.attempts.length
                    ? "Retry"
                    : "Generate"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="remix" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Reference image</Label>
                {refPath ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={projectFileUrl(slug, refPath)}
                      alt="reference"
                      className="w-32 aspect-video object-cover rounded-md border"
                    />
                    <div className="flex-1 text-xs text-muted-foreground">
                      <div className="font-mono break-all">{refPath}</div>
                      <button
                        type="button"
                        onClick={() => { setRefPath(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                        className="text-muted-foreground hover:text-foreground underline mt-1"
                      >
                        replace
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-amber-500 transition-colors"
                  >
                    <p className="text-sm font-semibold">
                      {upload.isPending ? "Uploading…" : "Drop an image or click to upload"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      PNG / JPG / WEBP, max 25 MB
                    </p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="remix-prompt">How should AI change it?</Label>
                <Textarea
                  id="remix-prompt"
                  rows={3}
                  value={remixPrompt}
                  onChange={(e) => setRemixPrompt(e.target.value)}
                  placeholder="Make it snow heavily outside the windows; add warm candlelight on the mantle; richer evening tones."
                  className="text-base"
                />
                <p className="text-xs text-muted-foreground">
                  Flux Kontext does best with short, concrete instructions. It
                  preserves what you don't mention.
                </p>
              </div>

              <ResolutionRadio value={resolution} onChange={setResolution} />

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-muted-foreground">
                  ~$0.05 per remix. Estimated: 15–40s.
                </div>
                <Button size="lg" onClick={() => remix.mutate()} disabled={!canRemix}>
                  {isGenerating ? "Generating…" : refPath ? "Remix" : "Upload first"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Active display */}
      <div>
        {isGenerating && !activeAttempt && (
          <Card>
            <CardContent className="aspect-video flex items-center justify-center bg-muted">
              <GeneratingPlaceholder estLow={estLow} estHigh={estHigh} />
            </CardContent>
          </Card>
        )}

        {activeAttempt && (
          <Card>
            <CardContent className="p-3 space-y-3">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={projectFileUrl(slug, activeAttempt.filename)}
                  alt={activeAttempt.id}
                  className="w-full rounded-md"
                />
                {isGenerating && (
                  <div className="absolute inset-0 bg-background/70 flex items-center justify-center rounded-md">
                    <GeneratingPlaceholder estLow={estLow} estHigh={estHigh} />
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span className="font-mono">
                  {activeAttempt.id} · {(activeAttempt.config as { resolution?: string }).resolution}
                  {(activeAttempt.config as { kind?: string }).kind === "remix" && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">
                      remix
                    </span>
                  )}
                </span>
                <span>{new Date(activeAttempt.created_at).toLocaleString()}</span>
              </div>
              {(activeAttempt.config as { reference?: string }).reference && (
                <div className="text-xs text-muted-foreground border-t pt-2 flex items-center gap-2">
                  <span>remixed from:</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={projectFileUrl(slug, (activeAttempt.config as { reference: string }).reference)}
                    alt="reference"
                    className="h-12 aspect-video object-cover rounded border"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* History strip */}
      {project && project.image.attempts.length > 1 && (
        <div>
          <Label className="text-xs">History ({project.image.attempts.length} attempts)</Label>
          <div className="flex gap-2 overflow-x-auto pb-2 mt-2">
            {project.image.attempts.map((a) => {
              const active = a.id === activeAttemptId;
              const isRemix = (a.config as { kind?: string }).kind === "remix";
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pickAttempt(a.id)}
                  className={`flex-shrink-0 rounded-md overflow-hidden border-2 relative ${
                    active ? "border-amber-500" : "border-transparent hover:border-foreground/30"
                  }`}
                  title={a.prompt}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={projectFileUrl(slug, a.filename)}
                    alt={a.id}
                    className="h-20 aspect-video object-cover"
                  />
                  {isRemix && (
                    <span className="absolute top-1 right-1 text-[9px] font-mono px-1 rounded bg-amber-500 text-white">
                      remix
                    </span>
                  )}
                  <div className="text-[10px] font-mono text-center py-0.5">{a.id}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {projectQ.isLoading && <Skeleton className="h-80 rounded-xl" />}
    </StudioShell>
  );
}

function ResolutionRadio({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Resolution</Label>
      <div className="flex gap-2">
        {RESOLUTIONS.map((r) => {
          const active = value === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onChange(r.id)}
              className={`flex-1 rounded-lg border-2 px-4 py-3 text-sm font-semibold transition-colors ${
                active
                  ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-foreground"
                  : "border-border hover:border-foreground/30 text-muted-foreground"
              }`}
            >
              <div>{r.label}</div>
              <div className="text-xs font-normal opacity-70">{r.hint}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GeneratingPlaceholder({ estLow, estHigh }: { estLow: number; estHigh: number }) {
  return (
    <div className="text-center text-sm text-muted-foreground space-y-2">
      <div className="inline-block w-8 h-8 rounded-full bg-amber-500 shadow-[0_0_24px_rgba(245,158,11,0.6)] animate-pulse" />
      <p className="font-semibold">Generating image…</p>
      <p className="text-xs">~{estLow}–{estHigh} seconds</p>
    </div>
  );
}
