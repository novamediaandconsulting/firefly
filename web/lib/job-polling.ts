"use client";

/**
 * Polling utilities — pages call `useJobPolling(slug, stages)` to get a
 * refetchInterval function that returns 2000ms when a relevant background job
 * is running and false otherwise. Reads from the TanStack Query cache so it
 * doesn't trigger any extra fetches itself.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { State } from "./types";

const POLL_INTERVAL_MS = 2000;

/** Returns a refetchInterval fn that polls while a job in `stages` is active. */
export function useJobPolling(slug: string, stages: string[]) {
  const queryClient = useQueryClient();
  return () => {
    const state = queryClient.getQueryData<State>(["project", slug]);
    const job = state?.current_job;
    if (!job || job.error) return false;
    if (stages.length === 0) return POLL_INTERVAL_MS;
    return stages.includes(job.stage) ? POLL_INTERVAL_MS : false;
  };
}

/** Refetch a project state every 2s whenever its current_job is non-null. */
export function projectRefetchInterval(): (query: {
  state: { data?: State };
}) => number | false {
  return (query) => {
    const data = query.state.data;
    return data?.current_job && !data.current_job.error ? POLL_INTERVAL_MS : false;
  };
}
