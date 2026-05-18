"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { projectRefetchInterval } from "@/lib/job-polling";
import { WIZARD_STEPS, type WizardStepId, nextStep, prevStep } from "@/lib/wizard";

interface WizardLayoutProps {
  slug: string;
  step: WizardStepId;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** If provided, "Continue" is enabled and triggers this callback before navigating. */
  onContinue?: () => Promise<void> | void;
  continueLabel?: string;
  continueDisabled?: boolean;
  /** Hide the next/back footer entirely (for steps that are still incomplete). */
  hideFooter?: boolean;
}

export function WizardLayout({
  slug,
  step,
  title,
  description,
  children,
  onContinue,
  continueLabel = "Continue",
  continueDisabled = false,
  hideFooter = false,
}: WizardLayoutProps) {
  const router = useRouter();
  const next = nextStep(step);
  const prev = prevStep(step);
  const costQ = useQuery({
    queryKey: ["cost", slug],
    queryFn: () => api.getCost(slug),
    retry: false,
    refetchInterval: 10_000, // refresh during long-running gen steps
  });
  // Drive project polling for the entire wizard — when a background job is
  // running, this query refetches every 2s and invalidates dependent manifest
  // queries via TanStack's normal flow.
  const stateQ = useQuery({
    queryKey: ["project", slug],
    queryFn: () => api.getProject(slug),
    retry: false,
    refetchInterval: projectRefetchInterval(),
  });
  const job = stateQ.data?.current_job ?? null;

  async function handleContinue() {
    if (onContinue) await onContinue();
    if (next) router.push(`/projects/${slug}/wizard/${next}`);
    else router.push(`/projects/${slug}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      {/* breadcrumb + job/cost */}
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/projects/${slug}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← back to project
        </Link>
        <div className="flex items-center gap-3">
          {job && (
            <div
              className={`text-xs px-2.5 py-1 rounded-md ${
                job.error
                  ? "bg-red-500/10 text-red-600"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              {job.error ? (
                <>
                  <span className="font-semibold">{job.stage} failed:</span>{" "}
                  {job.error}
                </>
              ) : (
                <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse mr-1.5" />
                  <span className="font-semibold">{job.stage}:</span>{" "}
                  {job.message}
                </>
              )}
            </div>
          )}
          {costQ.data && (
            <div className="text-xs text-muted-foreground">
              spent{" "}
              <span className="font-mono text-foreground">
                ${costQ.data.total_usd.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* step indicator */}
      <nav className="flex items-center gap-1 text-xs overflow-x-auto">
        {WIZARD_STEPS.map((s, i) => {
          const isCurrent = s.id === step;
          const isPast =
            WIZARD_STEPS.findIndex((x) => x.id === step) > i;
          return (
            <Link
              key={s.id}
              href={`/projects/${slug}/wizard/${s.id}`}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${
                isCurrent
                  ? "bg-foreground text-background font-medium"
                  : isPast
                  ? "text-foreground hover:bg-muted"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <span className="font-mono">{i + 1}.</span>
              <span>{s.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* heading */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>

      <div className="space-y-6">{children}</div>

      {!hideFooter && (
        <div className="flex items-center justify-between pt-6 border-t">
          <Button
            variant="ghost"
            onClick={() =>
              prev
                ? router.push(`/projects/${slug}/wizard/${prev}`)
                : router.push(`/projects/${slug}`)
            }
          >
            ← Back
          </Button>
          <Button onClick={handleContinue} disabled={continueDisabled}>
            {continueLabel} →
          </Button>
        </div>
      )}
    </div>
  );
}
