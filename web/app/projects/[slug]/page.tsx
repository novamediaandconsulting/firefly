"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, projectFileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

const STATUS_STYLE: Record<string, string> = {
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  awaiting_qa: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  failed: "bg-red-500/15 text-red-700 dark:text-red-400",
  pending: "bg-muted text-muted-foreground",
};

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const stateQ = useQuery({
    queryKey: ["project", slug],
    queryFn: () => api.getProject(slug),
  });
  const planQ = useQuery({
    queryKey: ["plan", slug],
    queryFn: () => api.getPlan(slug),
    enabled: stateQ.data?.stages.plan?.status === "done",
    retry: false,
  });
  const imagesQ = useQuery({
    queryKey: ["images", slug],
    queryFn: () => api.getImages(slug),
    enabled: ["done", "awaiting_qa"].includes(stateQ.data?.stages.images?.status ?? ""),
    retry: false,
  });
  const clipsQ = useQuery({
    queryKey: ["clips", slug],
    queryFn: () => api.getClips(slug),
    enabled: ["done", "awaiting_qa"].includes(stateQ.data?.stages.clips?.status ?? ""),
    retry: false,
  });
  const variantsQ = useQuery({
    queryKey: ["variants", slug],
    queryFn: () => api.listVariants(slug),
    retry: false,
  });
  const costQ = useQuery({
    queryKey: ["cost", slug],
    queryFn: () => api.getCost(slug),
    retry: false,
  });

  if (stateQ.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (stateQ.error) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load project</AlertTitle>
          <AlertDescription>{(stateQ.error as Error).message}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!stateQ.data) return null;
  const state = stateQ.data;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← all projects
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-2">
            {planQ.data?.working_title ?? state.slug}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{state.concept}</p>
          <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
            <Badge variant="secondary">{state.config.target_duration_minutes} min</Badge>
            <Badge variant="secondary">{state.config.resolution}</Badge>
            <span>·</span>
            <span>created {new Date(state.created_at).toLocaleString()}</span>
            {costQ.data && (
              <>
                <span>·</span>
                <span>spent ${costQ.data.total_usd.toFixed(2)}</span>
              </>
            )}
          </div>
        </div>
        <Button asChild>
          <Link href={`/projects/${slug}/wizard`}>Continue in wizard →</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {Object.entries(state.stages).map(([name, s]) => (
              <div
                key={name}
                className={`rounded-md p-3 text-center ${STATUS_STYLE[s.status]}`}
              >
                <div className="text-xs uppercase tracking-wide font-medium">{name}</div>
                <div className="text-[10px] opacity-80 mt-1">{s.status}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="images">Images ({imagesQ.data?.items.length ?? 0})</TabsTrigger>
          <TabsTrigger value="clips">Clips ({clipsQ.data?.items.length ?? 0})</TabsTrigger>
          <TabsTrigger value="finals">Finals ({variantsQ.data?.items.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {planQ.data && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Plan</CardTitle>
                <CardDescription>{planQ.data.visual_description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <div className="font-medium mb-1">Music mood</div>
                  <div className="text-muted-foreground">{planQ.data.music_mood}</div>
                </div>
                <div>
                  <div className="font-medium mb-1">SFX layers ({planQ.data.sfx_layers.length})</div>
                  <ul className="text-muted-foreground space-y-1">
                    {planQ.data.sfx_layers.map((sfx) => (
                      <li key={sfx.name}>
                        <span className="text-foreground">{sfx.name}</span>{" "}
                        <span className="text-xs">@ {sfx.gain_db}dB</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="font-medium mb-1">Camera</div>
                  <div className="text-muted-foreground">{planQ.data.camera}</div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="images">
          {imagesQ.data && imagesQ.data.items.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {imagesQ.data.items.map((img) => (
                <Card key={img.id} className={img.approved ? "ring-2 ring-emerald-500" : ""}>
                  <CardContent className="p-2 space-y-2">
                    <img
                      src={projectFileUrl(slug, `images/${img.filename}`)}
                      alt={img.id}
                      className="rounded-md w-full aspect-video object-cover"
                    />
                    <div className="flex items-center justify-between text-xs px-1">
                      <span className="font-mono">{img.id}</span>
                      {img.approved && <Badge>approved</Badge>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No images generated yet.</p>
          )}
        </TabsContent>

        <TabsContent value="clips">
          {clipsQ.data && clipsQ.data.items.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {clipsQ.data.items.map((clip) => (
                <Card key={clip.id} className={clip.approved ? "ring-2 ring-emerald-500" : ""}>
                  <CardContent className="p-2 space-y-2">
                    <video
                      src={projectFileUrl(slug, `clips/${clip.filename}`)}
                      controls
                      muted
                      className="rounded-md w-full aspect-video bg-black"
                    />
                    <div className="flex items-center justify-between text-xs px-1">
                      <span className="font-mono">{clip.id}</span>
                      <span className="text-muted-foreground">{clip.duration_s}s</span>
                      {clip.approved && <Badge>approved</Badge>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No clips generated yet.</p>
          )}
        </TabsContent>

        <TabsContent value="finals">
          {variantsQ.data && variantsQ.data.items.length > 0 ? (
            <div className="space-y-4">
              {variantsQ.data.items.map((v) => (
                <Card key={v.name}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{v.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {v.duration_min} min · audio: {v.audio_mode} ·{" "}
                          {(v.bytes / (1024 * 1024)).toFixed(0)} MB ·{" "}
                          {new Date(v.created_at).toLocaleString()}
                        </div>
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <a href={projectFileUrl(slug, v.mp4_path)} target="_blank">
                          Open
                        </a>
                      </Button>
                    </div>
                    <video
                      src={projectFileUrl(slug, v.mp4_path)}
                      controls
                      className="rounded-md w-full aspect-video bg-black"
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No final variants yet. Use the CLI to render one: <code>firefly render {slug} 30min -d 30</code>
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
