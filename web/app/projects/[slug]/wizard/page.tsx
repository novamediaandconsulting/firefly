"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { suggestStep } from "@/lib/wizard";

/** Redirect /wizard → the next incomplete wizard step. */
export default function WizardIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["project", slug],
    queryFn: () => api.getProject(slug),
  });
  useEffect(() => {
    if (data) router.replace(`/projects/${slug}/wizard/${suggestStep(data)}`);
  }, [data, slug, router]);
  return <div className="mx-auto max-w-6xl px-6 py-8 text-muted-foreground">Loading…</div>;
}
