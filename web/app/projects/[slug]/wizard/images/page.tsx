"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import type { ImageItem } from "@/lib/types";
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

  const generate = useMutation({
    mutationFn: () => api.generateImages(slug, count, false),
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
      toast.success("Approved");
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
      description="Generate candidate stills and pick the one you want clips to be made from. Approved images get a green outline."
      continueDisabled={approvedIds.size === 0}
      continueLabel={
        approvedIds.size === 0 ? "Approve at least one image first" : "Continue"
      }
    >
      <Card>
        <CardContent className="py-4 flex items-center gap-4">
          <div className="flex-1">
            <Label htmlFor="count" className="text-xs">
              How many candidates to generate
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              ~$0.05 per image (Flux Pro 1.1). The plan currently has{" "}
              {planQ.data?.image_prompts.length ?? 0} unique prompt(s); more
              candidates cycle through them.
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
            {generate.isPending ? "Generating…" : `Generate ${count}`}
          </Button>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {generate.isPending
            ? "Generating candidates… each takes ~10-20s."
            : "No images yet. Click 'Generate' above to start."}
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
            Costs another ~$0.05. The previous version is preserved as a
            .bak&lt;ts&gt;.png file next to the original.
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
