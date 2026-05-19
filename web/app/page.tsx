"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, projectFileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STEP_STYLE: Record<string, string> = {
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  image: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  clip: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  sfx: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  music: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  mix: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  final: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  title: "bg-muted text-muted-foreground",
};

export default function GalleryPage() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1>Projects</h1>
          <p className="text-lg text-muted-foreground mt-1">
            Pick one to continue, or start a new one.
          </p>
        </div>
        <Button size="lg" onClick={() => setOpen(true)}>
          + New project
        </Button>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t reach the studio server</AlertTitle>
          <AlertDescription>
            {(error as Error).message}. Make sure <code>./dev.sh</code> is running.
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      )}

      {data && data.length === 0 && !error && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground space-y-3">
            <p className="text-lg">No projects yet.</p>
            <Button onClick={() => setOpen(true)}>Start your first project</Button>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <Link key={p.slug} href={`/projects/${p.slug}/studio`}>
              <Card className="hover:border-amber-500/50 hover:shadow-lg transition-all h-full overflow-hidden">
                <div className="aspect-video bg-muted relative">
                  {p.thumbnail_path ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={projectFileUrl(p.slug, p.thumbnail_path)}
                      alt={p.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                      no image yet
                    </div>
                  )}
                  {p.legacy && (
                    <Badge
                      variant="secondary"
                      className="absolute top-2 right-2 bg-zinc-900/70 text-white border-0"
                    >
                      legacy
                    </Badge>
                  )}
                </div>
                <CardContent className="p-4 space-y-2">
                  <h3 className="text-lg leading-tight line-clamp-2">{p.title}</h3>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      last edited{" "}
                      {new Date(p.last_modified_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                        STEP_STYLE[p.current_step] ?? STEP_STYLE.title
                      }`}
                    >
                      {p.completed ? "done" : p.current_step}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <NewProjectDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const router = useRouter();
  const queryClient = useQueryClient();

  const slugQ = useQuery({
    queryKey: ["slug-preview", title],
    queryFn: () => api.slugPreview(title),
    enabled: title.trim().length > 0,
    staleTime: 1_000,
  });

  const create = useMutation({
    mutationFn: () => api.createProject(title.trim()),
    onSuccess: (p) => {
      toast.success(`Created ${p.slug}`);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
      setTitle("");
      router.push(`/projects/${p.slug}/studio`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Give it a title — we&apos;ll derive the URL slug automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Project title</Label>
            <Input
              id="title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Redwood Cabin Morning"
            />
          </div>
          {slugQ.data && (
            <div className="text-sm">
              <span className="text-muted-foreground">URL slug:</span>{" "}
              <code className="font-mono text-amber-600">{slugQ.data.final_slug}</code>
              {slugQ.data.conflict && (
                <span className="text-xs text-muted-foreground ml-2">
                  ({slugQ.data.raw_slug} already taken — suffixed)
                </span>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!title.trim() || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
