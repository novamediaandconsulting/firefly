"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  STUDIO_STEPS,
  type StudioStepId,
  nextStep as nextStepId,
  prevStep as prevStepId,
  isStepDone,
} from "@/lib/studio-steps";
import { Button } from "@/components/ui/button";
import type { StudioProject } from "@/lib/types";

interface StudioShellProps {
  slug: string;
  step: StudioStepId;
  title: string;
  description?: string;
  children: React.ReactNode;
  onContinue?: () => Promise<void> | void;
  continueLabel?: string;
  continueDisabled?: boolean;
  hideFooter?: boolean;
}

export function StudioShell({
  slug,
  step,
  title,
  description,
  children,
  onContinue,
  continueLabel = "Continue",
  continueDisabled = false,
  hideFooter = false,
}: StudioShellProps) {
  const router = useRouter();
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

  const costQ = useQuery({
    queryKey: ["cost-by-step", slug],
    queryFn: () => api.costByStep(slug),
    retry: false,
    refetchInterval: 10_000,
  });

  const project = projectQ.data;
  const job = project?.current_job ?? null;

  const clearJob = useMutation({
    mutationFn: () => api.clearJob(slug),
    onSuccess: () => {
      toast.success("Job cleared");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const next = nextStepId(step);
  const prev = prevStepId(step);

  async function handleContinue() {
    if (onContinue) await onContinue();
    if (next) router.push(`/projects/${slug}/studio/${next}`);
    else router.push("/");
  }

  const stepCost = costQ.data?.by_step[step] ?? 0;
  const totalCost = costQ.data?.total_usd ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      {/* breadcrumb + costs */}
      <div className="flex items-center justify-between gap-4 text-sm">
        <Link href="/" className="text-muted-foreground hover:text-foreground">
          ← all projects
        </Link>
        <div className="flex items-center gap-3">
          {job && (
            <div
              className={`flex items-center gap-2 text-xs px-2.5 py-1 rounded-md ${
                job.error
                  ? "bg-red-500/10 text-red-600"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              {job.error ? (
                <>
                  <span>
                    <span className="font-semibold">{job.stage} failed:</span>{" "}
                    {job.error}
                  </span>
                  <button
                    type="button"
                    onClick={() => clearJob.mutate()}
                    className="underline hover:no-underline"
                  >
                    dismiss
                  </button>
                </>
              ) : (
                <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>
                    <span className="font-semibold">{job.stage}:</span> {job.message}
                  </span>
                  <button
                    type="button"
                    onClick={() => clearJob.mutate()}
                    className="text-muted-foreground hover:text-foreground"
                    title="Force-clear (worker keeps running; use only if stuck)"
                  >
                    cancel
                  </button>
                </>
              )}
            </div>
          )}
          <span className="text-xs text-muted-foreground">
            this step{" "}
            <span className="font-mono text-foreground">${stepCost.toFixed(2)}</span>
            {" · "}
            total{" "}
            <span className="font-mono text-foreground">${totalCost.toFixed(2)}</span>
          </span>
        </div>
      </div>

      {/* project title strip */}
      {project && (
        <div className="flex items-center justify-between gap-3 pb-1">
          <h2 className="text-base font-semibold truncate">{project.title}</h2>
          <Link
            href={`/projects/${slug}/studio/title`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            rename
          </Link>
        </div>
      )}

      {/* step ruler */}
      <nav className="flex items-center gap-1 text-sm overflow-x-auto">
        {STUDIO_STEPS.map((s, i) => {
          const done = project ? isStepDone(project, s.id) : false;
          const isCurrent = s.id === step;
          return (
            <Link
              key={s.id}
              href={`/projects/${slug}/studio/${s.id}`}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                isCurrent
                  ? "bg-amber-500 text-white font-bold shadow-sm"
                  : done
                  ? "text-foreground hover:bg-muted"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <span className="font-mono text-xs opacity-70">{i + 1}.</span>
              <span>{s.label}</span>
              {done && !isCurrent && <span className="text-emerald-600">✓</span>}
            </Link>
          );
        })}
      </nav>

      {/* heading */}
      <div>
        <h1>{title}</h1>
        {description && (
          <p className="text-lg text-muted-foreground mt-2">{description}</p>
        )}
      </div>

      <div className="space-y-6">{children}</div>

      {!hideFooter && (
        <div className="flex items-center justify-between pt-6 border-t">
          <Button
            variant="ghost"
            onClick={() =>
              prev
                ? router.push(`/projects/${slug}/studio/${prev}`)
                : router.push("/")
            }
          >
            ← Back
          </Button>
          <Button onClick={handleContinue} disabled={continueDisabled} size="lg">
            {continueLabel} →
          </Button>
        </div>
      )}
    </div>
  );
}
