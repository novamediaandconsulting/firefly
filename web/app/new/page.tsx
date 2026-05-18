"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NewProjectPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [concept, setConcept] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [resolution, setResolution] = useState("1080p");

  const mut = useMutation({
    mutationFn: () =>
      api.createProject({
        slug: slug.trim(),
        concept: concept.trim(),
        duration_min: durationMin,
        resolution,
      }),
    onSuccess: (s) => {
      toast.success(`Created ${s.slug}`);
      router.push(`/projects/${s.slug}/wizard/plan`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = slug.trim().length > 0 && concept.trim().length > 10;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>
            Start by giving your video a slug and describing the scene.
            We&apos;ll generate a plan in the next step.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              placeholder="e.g. redwood-cabin"
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
              }
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and dashes. Used in URLs and filenames.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="concept">Concept</Label>
            <textarea
              id="concept"
              rows={6}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Cozy library with a crackling fireplace and snow falling outside…"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duration">Target duration (min)</Label>
              <Input
                id="duration"
                type="number"
                min={5}
                max={480}
                value={durationMin}
                onChange={(e) =>
                  setDurationMin(Math.max(5, Math.min(480, Number(e.target.value))))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resolution">Resolution</Label>
              <select
                id="resolution"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-ring"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4k</option>
              </select>
            </div>
          </div>

          <Button
            onClick={() => mut.mutate()}
            disabled={!canSubmit || mut.isPending}
            className="w-full"
          >
            {mut.isPending ? "Creating…" : "Create project"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
