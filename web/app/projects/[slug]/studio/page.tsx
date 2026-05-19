"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { currentStep } from "@/lib/studio-steps";

/** Redirect /studio → the next incomplete step. */
export default function StudioIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["project", slug],
    queryFn: () => api.getProject(slug),
    retry: false,
  });
  useEffect(() => {
    if (data) router.replace(`/projects/${slug}/studio/${currentStep(data)}`);
  }, [data, slug, router]);
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 text-muted-foreground">
      Loading project…
    </div>
  );
}
