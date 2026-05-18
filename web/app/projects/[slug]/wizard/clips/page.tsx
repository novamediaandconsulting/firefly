"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import type { ClipItem } from "@/lib/types";
import { WizardLayout } from "@/components/wizard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ClipsStep({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();
  const [perImage, setPerImage] = useState(1);
  const [regenTarget, setRegenTarget] = useState<ClipItem | null>(null);
  const [regenPrompt, setRegenPrompt] = useState("");

  const imagesQ = useQuery({
    queryKey: ["images", slug],
    queryFn: () => api.getImages(slug),
    retry: false,
  });
  const clipsQ = useQuery({
    queryKey: ["clips", slug],
    queryFn: () => api.getClips(slug),
    retry: false,
  });

  const approvedImages = (imagesQ.data?.items ?? []).filter((i) => i.approved);
  const items = clipsQ.data?.items ?? [];
  const approvedIds = new Set(items.filter((c) => c.approved).map((c) => c.id));

  const generate = useMutation({
    mutationFn: (count: number) => api.generateClips(slug, count, false),
    onSuccess: () => {
      toast.success("Clip(s) generated");
      queryClient.invalidateQueries({ queryKey: ["clips", slug] });
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: (ids: string[]) => api.approveClips(slug, ids),
    onSuccess: () => {
      toast.success("Picked");
      queryClient.invalidateQueries({ queryKey: ["clips", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regen = useMutation({
    mutationFn: ({ id, prompt }: { id: string; prompt?: string }) =>
      api.regenClip(slug, id, prompt),
    onSuccess: () => {
      toast.success("Regenerated");
      setRegenTarget(null);
      setRegenPrompt("");
      queryClient.invalidateQueries({ queryKey: ["clips", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loop = useMutation({
    mutationFn: () => api.buildLoop(slug, undefined, false),
    onError: (e: Error) => toast.error(`loop failed: ${e.message}`),
  });

  async function pickClip(item: ClipItem) {
    const previous = items
      .filter((c) => c.approved && c.id !== item.id)
      .map((c) => c.id);
    if (previous.length) {
      await api.unapproveClips(slug, previous);
    }
    await approve.mutateAsync([item.id]);
  }

  async function continueToSfx() {
    if (approvedIds.size === 0) return;
    if (!loop.isPending) {
      const t = toast.loading("Assembling loopable video…");
      try {
        await loop.mutateAsync();
        toast.success("Loop built", { id: t });
      } catch (e) {
        toast.error((e as Error).message, { id: t });
        throw e;
      }
    }
  }

  if (approvedImages.length === 0) {
    return (
      <WizardLayout
        slug={slug}
        step="clips"
        title="Clips"
        description="Generate motion variants from your approved image."
        hideFooter
      >
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Approve an image first in the previous step.
          </CardContent>
        </Card>
      </WizardLayout>
    );
  }

  return (
    <WizardLayout
      slug={slug}
      step="clips"
      title="Clips"
      description="Each clip is a 10s motion variation of your scene. Pick the one with the cleanest, most natural motion."
      continueDisabled={approvedIds.size === 0 || loop.isPending}
      continueLabel={
        approvedIds.size === 0
          ? "Pick a clip first"
          : loop.isPending
          ? "Building loop…"
          : "Continue"
      }
      onContinue={continueToSfx}
    >
      <Card>
        <CardContent className="py-4 flex items-center gap-4">
          <div className="flex-1">
            <Label htmlFor="count" className="text-xs">
              {items.length === 0
                ? "How many clips to start with"
                : "Generate another batch"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              ~$1.12 per 10-sec clip (Kling v3 pro, audio off). Default is 1
              — generate more if the first doesn&apos;t land.
              {approvedImages.length > 1 &&
                ` × ${approvedImages.length} approved images = ${perImage * approvedImages.length} total`}
            </p>
          </div>
          <Input
            id="count"
            type="number"
            min={1}
            max={10}
            value={perImage}
            onChange={(e) =>
              setPerImage(Math.max(1, Math.min(10, Number(e.target.value))))
            }
            className="w-24"
          />
          <Button
            onClick={() => generate.mutate(perImage)}
            disabled={generate.isPending}
          >
            {generate.isPending
              ? "Generating…"
              : items.length === 0
              ? `Generate ${perImage}`
              : `Generate ${perImage} more`}
          </Button>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {generate.isPending
            ? "Each clip takes ~30-90s on Kling. Be patient."
            : "No clips yet. Click 'Generate' above."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((clip) => (
            <Card
              key={clip.id}
              className={
                approvedIds.has(clip.id) ? "ring-2 ring-emerald-500" : ""
              }
            >
              <CardContent className="p-2 space-y-2">
                <video
                  src={projectFileUrl(slug, `clips/${clip.filename}`)}
                  controls
                  muted
                  className="rounded-md w-full aspect-video bg-black"
                />
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="font-mono">{clip.id}</span>
                  <div className="flex items-center gap-1">
                    {approvedIds.has(clip.id) && <Badge>picked</Badge>}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRegenTarget(clip);
                        setRegenPrompt(clip.prompt);
                      }}
                    >
                      ↻
                    </Button>
                    <Button
                      size="sm"
                      variant={approvedIds.has(clip.id) ? "secondary" : "outline"}
                      onClick={() => pickClip(clip)}
                    >
                      {approvedIds.has(clip.id) ? "Picked" : "Pick"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!regenTarget}
        onOpenChange={(open) => !open && setRegenTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Regenerate {regenTarget?.id} — backs up previous version
            </DialogTitle>
          </DialogHeader>
          <Textarea
            rows={6}
            value={regenPrompt}
            onChange={(e) => setRegenPrompt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Costs another ~$1.12. Previous version preserved as a .bak file.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegenTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                regen.mutate({ id: regenTarget!.id, prompt: regenPrompt })
              }
              disabled={regen.isPending}
            >
              {regen.isPending ? "Regenerating…" : "Regenerate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WizardLayout>
  );
}
