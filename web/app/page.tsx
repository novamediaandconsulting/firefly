"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

const STAGE_ORDER = [
  "plan",
  "images",
  "clips",
  "loop",
  "audio",
  "mux",
] as const;

const STATUS_STYLE: Record<string, string> = {
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  awaiting_qa: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  failed: "bg-red-500/15 text-red-700 dark:text-red-400",
  pending: "bg-muted text-muted-foreground",
};

function StageDots({ progress }: { progress: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {STAGE_ORDER.map((stage) => {
        const status = progress[stage] ?? "pending";
        return (
          <span
            key={stage}
            title={`${stage}: ${status}`}
            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
              STATUS_STYLE[status] ?? STATUS_STYLE.pending
            }`}
          >
            {stage}
          </span>
        );
      })}
    </div>
  );
}

export default function ProjectsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Resume an existing video or start a new one.
          </p>
        </div>
        <Button asChild>
          <Link href="/new">+ New project</Link>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>API unreachable</AlertTitle>
          <AlertDescription>
            {(error as Error).message}. Make sure `firefly api` is running
            on port 8000.
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      )}

      {data && data.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No projects yet.</p>
            <Button asChild className="mt-4">
              <Link href="/new">Start your first project</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((proj) => (
            <Link key={proj.slug} href={`/projects/${proj.slug}`}>
              <Card className="hover:border-foreground/40 transition-colors h-full">
                <CardHeader>
                  <CardTitle className="text-base">{proj.slug}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {proj.concept}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">
                      {proj.target_duration_minutes} min
                    </Badge>
                    <Badge variant="secondary">{proj.resolution}</Badge>
                    <span>·</span>
                    <span>
                      {new Date(proj.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <StageDots progress={proj.stage_progress} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
