"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, projectFileUrl } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

/** Sticky thumbnail of the user's approved image — anchors later wizard steps. */
export function PickedImageAnchor({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
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

  const picked = imagesQ.data?.items.find((i) => i.approved);
  if (!picked) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 hover:bg-muted transition-colors text-left w-full"
      >
        <img
          src={projectFileUrl(slug, `images/${picked.filename}`)}
          alt={`picked: ${picked.id}`}
          className="w-20 h-12 object-cover rounded-md flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            {planQ.data?.working_title ?? slug}
          </div>
          <div className="text-xs text-muted-foreground">
            picked: <span className="font-mono">{picked.id}</span>
          </div>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          click to expand
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogTitle className="sr-only">
            Picked image: {picked.id}
          </DialogTitle>
          <img
            src={projectFileUrl(slug, `images/${picked.filename}`)}
            alt={`picked: ${picked.id}`}
            className="w-full rounded-md"
          />
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">
            {picked.prompt}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
