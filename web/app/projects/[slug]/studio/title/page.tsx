"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { StudioShell } from "@/components/studio-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function TitleStep({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const queryClient = useQueryClient();
  const { data: project } = useQuery({
    queryKey: ["project", slug],
    queryFn: () => api.getProject(slug),
    retry: false,
  });

  const [title, setTitle] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (project) {
      setTitle(project.title);
      setDirty(false);
    }
  }, [project]);

  const save = useMutation({
    mutationFn: () => api.updateTitle(slug, title.trim()),
    onSuccess: () => {
      toast.success("Title saved");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function continueIfDirty() {
    if (dirty && title.trim()) await save.mutateAsync();
  }

  return (
    <StudioShell
      slug={slug}
      step="title"
      title="Title"
      description="The name shown in the gallery and used as the URL slug. The slug is fixed at creation; renaming only changes the display title."
      onContinue={continueIfDirty}
      continueLabel={dirty ? "Save & continue" : "Continue"}
      continueDisabled={!title.trim() || save.isPending}
    >
      <Card>
        <CardContent className="py-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Project title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              className="text-lg"
            />
            <p className="text-xs text-muted-foreground">
              URL slug:{" "}
              <code className="font-mono text-amber-600">{slug}</code>{" "}
              (fixed at creation)
            </p>
            {dirty && (
              <p className="text-xs text-amber-600">
                Unsaved changes — saves when you click Continue.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </StudioShell>
  );
}
