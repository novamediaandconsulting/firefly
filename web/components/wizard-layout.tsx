"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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

  async function handleContinue() {
    if (onContinue) await onContinue();
    if (next) router.push(`/projects/${slug}/wizard/${next}`);
    else router.push(`/projects/${slug}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      {/* breadcrumb */}
      <div>
        <Link
          href={`/projects/${slug}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← back to project
        </Link>
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
