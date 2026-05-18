"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { WizardLayout } from "@/components/wizard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

export default function TitleStep({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();

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

  const [title, setTitle] = useState("");
  const [visualDescription, setVisualDescription] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (planQ.data) {
      setTitle(planQ.data.working_title);
      setVisualDescription(planQ.data.visual_description);
      setDirty(false);
    }
  }, [planQ.data]);

  const generate = useMutation({
    mutationFn: () => api.generatePlan(slug, true),
    onSuccess: () => {
      toast.success("Plan regenerated");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["plan", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateInitial = useMutation({
    mutationFn: () => api.generatePlan(slug, false),
    onSuccess: () => {
      toast.success("Plan generated");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["plan", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!planQ.data) throw new Error("no plan to save");
      return api.updatePlan(slug, {
        ...planQ.data,
        working_title: title.trim() || planQ.data.working_title,
        visual_description: visualDescription.trim() || planQ.data.visual_description,
      });
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["plan", slug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // No plan yet → ask user to generate it.
  if (stateQ.data && !planQ.data && stateQ.data.stages.plan?.status !== "done") {
    return (
      <WizardLayout
        slug={slug}
        step="title"
        title="Title"
        description="Let Claude turn your concept into a structured plan."
        hideFooter
      >
        <Card>
          <CardContent className="py-10 text-center space-y-4">
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {stateQ.data.concept}
            </p>
            <Button
              onClick={() => generateInitial.mutate()}
              disabled={generateInitial.isPending}
            >
              {generateInitial.isPending ? "Thinking…" : "Generate plan"}
            </Button>
          </CardContent>
        </Card>
      </WizardLayout>
    );
  }

  if (!planQ.data) {
    return (
      <WizardLayout slug={slug} step="title" title="Title" hideFooter>
        <Skeleton className="h-40" />
      </WizardLayout>
    );
  }

  async function continueIfClean() {
    if (dirty) await save.mutateAsync();
  }

  return (
    <WizardLayout
      slug={slug}
      step="title"
      title="Title & concept"
      description="The high-level identity for your video. Each later step has its own description box for the specifics."
      onContinue={continueIfClean}
      continueLabel={dirty ? "Save & continue" : "Continue"}
      continueDisabled={save.isPending}
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Plan summary</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            {generate.isPending ? "Regenerating…" : "↻ Regenerate from concept"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Working title</Label>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Visual description</Label>
            <p className="text-xs text-muted-foreground">
              The overall feel of the video. Per-step description boxes refine
              specifics (image prompts, clip motion, SFX layers).
            </p>
            <Textarea
              rows={6}
              value={visualDescription}
              onChange={(e) => {
                setVisualDescription(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          {dirty && (
            <p className="text-xs text-amber-600">Unsaved changes — they save when you click Continue.</p>
          )}
        </CardContent>
      </Card>
    </WizardLayout>
  );
}
