"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, projectFileUrl } from "@/lib/api";
import type { GalleryImage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ImageGalleryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [zoom, setZoom] = useState<GalleryImage | null>(null);
  const galleryQ = useQuery({
    queryKey: ["gallery", "images", slug],
    queryFn: () => api.getImageGallery(slug),
    retry: false,
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <div>
        <Link
          href={`/projects/${slug}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← back to project
        </Link>
        <h1 className="mt-2">Image gallery</h1>
        <p className="text-muted-foreground mt-1">
          Every image ever generated in this project — current candidates and
          every regen backup. Nothing is deleted.
        </p>
      </div>

      {galleryQ.isLoading && (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      )}

      {galleryQ.error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load gallery</AlertTitle>
          <AlertDescription>{(galleryQ.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {galleryQ.data && galleryQ.data.groups.length === 0 && galleryQ.data.extras.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No images generated yet for this project.
          </CardContent>
        </Card>
      )}

      {galleryQ.data?.groups.map((group) => (
        <section key={group.base_id} className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-mono">{group.base_id}</h2>
            <span className="text-sm text-muted-foreground">
              {group.items.length} version{group.items.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((img) => (
              <GalleryCard
                key={img.filename}
                slug={slug}
                img={img}
                onZoom={setZoom}
              />
            ))}
          </div>
        </section>
      ))}

      {galleryQ.data && galleryQ.data.extras.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2>Extras</h2>
            <span className="text-sm text-muted-foreground">
              one-off images not tied to a candidate
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {galleryQ.data.extras.map((img) => (
              <GalleryCard
                key={img.filename}
                slug={slug}
                img={img}
                onZoom={setZoom}
              />
            ))}
          </div>
        </section>
      )}

      <Dialog open={!!zoom} onOpenChange={(open) => !open && setZoom(null)}>
        <DialogContent className="max-w-5xl">
          <DialogTitle className="sr-only">{zoom?.filename}</DialogTitle>
          {zoom && (
            <div className="space-y-3">
              <img
                src={projectFileUrl(slug, zoom.path)}
                alt={zoom.filename}
                className="w-full rounded-md"
              />
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono">{zoom.filename}</span>
                {zoom.is_current && <Badge>current</Badge>}
                {zoom.approved && <Badge variant="secondary">approved</Badge>}
                {zoom.timestamp && (
                  <span className="text-muted-foreground">
                    backup from {new Date(zoom.timestamp * 1000).toLocaleString()}
                  </span>
                )}
              </div>
              {zoom.prompt && (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {zoom.prompt}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GalleryCard({
  slug,
  img,
  onZoom,
}: {
  slug: string;
  img: GalleryImage;
  onZoom: (img: GalleryImage) => void;
}) {
  return (
    <Card
      className={
        img.is_current
          ? "ring-1 ring-amber-500/50"
          : "opacity-90 hover:opacity-100 transition-opacity"
      }
    >
      <CardContent className="p-2 space-y-2">
        <button
          type="button"
          onClick={() => onZoom(img)}
          className="block w-full"
        >
          <img
            src={projectFileUrl(slug, img.path)}
            alt={img.filename}
            className="rounded-md w-full aspect-video object-cover"
          />
        </button>
        <div className="flex items-center justify-between text-xs px-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono truncate">{img.filename}</span>
            {img.approved && <Badge variant="secondary">approved</Badge>}
            {img.is_current && !img.approved && <Badge variant="outline">current</Badge>}
          </div>
          <Button asChild size="sm" variant="ghost">
            <a href={projectFileUrl(slug, img.path)} target="_blank" download>
              ⤓
            </a>
          </Button>
        </div>
        {img.timestamp && (
          <div className="text-[10px] text-muted-foreground px-1">
            backup from {new Date(img.timestamp * 1000).toLocaleString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
