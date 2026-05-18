"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import type { ImageItem } from "@/lib/types";
import { WizardLayout } from "@/components/wizard-layout";
import { PromptListEditor } from "@/components/prompt-list-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ImagesStep({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();
  const [count, setCount] = useState(4);
  const [regenTarget, setRegenTarget] = useState<ImageItem | null>(null);
  const [regenPrompt, setRegenPrompt] = useState("");
  const [imagePrompts, setImagePrompts] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  const imagesQ = useQuery({
    queryKey: ["images", slug],
    queryFn: () => api.getImages(slug),
    retry: false,
  });
  const planQ = useQuery({
    queryKey: ["plan", slug],
    queryFn: () => api.getPlan(slug),
    retry: false,
  });
  const items = imagesQ.data?.items ?? [];
  const approvedIds = new Set(items.filter((i) => i.approved).map((i) => i.id));

  useEffect(() => {
    if (planQ.data) {
      setImagePrompts(planQ.data.image_prompts);
      setDirty(false);
    }
  }, [planQ.data]);

  const savePlan = useMutation({
    mutationFn: async () => {
      if (!planQ.data) throw new Error("no plan");
      return api.updatePlan(slug, {
        ...planQ.data,
        image_prompts: imagePrompts.map((p) => p.trim()).filter(Boolean),
      });
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["plan", slug] });
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (dirty) await savePlan.mutateAsync();
      return api.generateImages(slug, count, false);
    },
    onSuccess: () => {
      toast.success("Images generated");
      queryClient.invalidateQueries({ queryKey: ["images", slug] });
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: (ids: string[]) => api.approveImages(slug, ids),
    onSuccess: () => {
      toast.success("Picked");
      queryClient.invalidateQueries({ queryKey: ["images", slug] });
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regen = useMutation({
    mutationFn: ({ id, prompt }: { id: string; prompt?: string }) =>
      api.regenImage(slug, id, prompt),
    onSuccess: () => {
      toast.success("Regenerated");
      setRegenTarget(null);
      setRegenPrompt("");
      queryClient.invalidateQueries({ queryKey: ["images", slug] });
      queryClient.invalidateQueries({ queryKey: ["cost", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function toggleApproval(item: ImageItem) {
    const newApproved = approvedIds.has(item.id) ? [] : [item.id];
    const toUnapprove = items
      .filter((i) => i.approved && !newApproved.includes(i.id))
      .map((i) => i.id);
    if (toUnapprove.length) {
      await api.unapproveImages(slug, toUnapprove);
    }
    if (newApproved.length) {
      await approve.mutateAsync(newApproved);
    } else {
      queryClient.invalidateQueries({ queryKey: ["images", slug] });
    }
  }

  return (
    <WizardLayout
      slug={slug}
      step="images"
      title="Images"
      description="Generate candidate stills and pick the one you want clips to be made from. Edit the prompts below to steer the look before generating."
      continueDisabled={approvedIds.size === 0}
      continueLabel={
        approvedIds.size === 0 ? "Approve an image first" : "Continue"
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Image prompts</span>
            {dirty && (
              <span className="text-xs text-amber-600 font-normal">
                unsaved — saves on generate
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Each candidate cycles through this list. More entries = more
            visual variety between candidates.
          </p>
        </CardHeader>
        <CardContent>
          <PromptListEditor
            prompts={imagePrompts}
            onChange={(next) => {
              setImagePrompts(next);
              setDirty(true);
            }}
            addLabel="+ Add variation"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 flex items-center gap-4">
          <div className="flex-1">
            <Label htmlFor="count" className="text-xs">
              How many candidates to generate
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              ~$0.05 per image (Flux Pro 1.1).
            </p>
          </div>
          <Input
            id="count"
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) =>
              setCount(Math.max(1, Math.min(20, Number(e.target.value))))
            }
            className="w-24"
          />
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            {generate.isPending
              ? "Generating…"
              : items.length === 0
              ? `Generate ${count}`
              : `Generate ${count} more`}
          </Button>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {generate.isPending
            ? "Generating candidates… each takes ~10-20s."
            : "No images yet. Click 'Generate' above."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((img) => (
            <Card
              key={img.id}
              className={
                approvedIds.has(img.id) ? "ring-2 ring-emerald-500" : ""
              }
            >
              <CardContent className="p-2 space-y-2">
                <img
                  src={projectFileUrl(slug, `images/${img.filename}`)}
                  alt={img.id}
                  className="rounded-md w-full aspect-video object-cover cursor-pointer"
                  onClick={() => toggleApproval(img)}
                />
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="font-mono">{img.id}</span>
                  <div className="flex items-center gap-1">
                    {approvedIds.has(img.id) && <Badge>picked</Badge>}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRegenTarget(img);
                        setRegenPrompt(img.prompt);
                      }}
                    >
                      ↻
                    </Button>
                    <Button
                      size="sm"
                      variant={approvedIds.has(img.id) ? "secondary" : "outline"}
                      onClick={() => toggleApproval(img)}
                    >
                      {approvedIds.has(img.id) ? "Picked" : "Pick"}
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
            Costs another ~$0.05. Previous version preserved as a .bak file.
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
