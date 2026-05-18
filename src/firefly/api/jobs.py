"""Background job runner for the FastAPI service.

Wraps stage functions so they run in a worker thread; the HTTP request returns
202 immediately. The web wizard polls `state.current_job` to know when to
refresh manifests for progressive loading.

Concurrency: one job per project (rejected with 409 if a job is already
running). Multiple projects can run jobs concurrently up to max_workers.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Callable

from fastapi import HTTPException

from ..project import Project
from ..schemas import JobStatus

logger = logging.getLogger("firefly.api.jobs")

# A single executor shared across all projects. Local single-user app —
# don't need a real queue.
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="firefly-job")


def start_job(
    project: Project,
    *,
    stage: str,
    message: str,
    fn: Callable[[], None],
) -> JobStatus:
    """Set state.current_job and submit `fn` to the worker pool.

    Raises HTTPException(409) if a job is already running for this project.
    Returns the JobStatus that was set on state (for inclusion in the 202 body).
    """
    state = project.load_state()
    if state.current_job is not None and state.current_job.error is None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"a {state.current_job.stage} job is already running "
                f"(started {state.current_job.started_at.isoformat()})"
            ),
        )
    job = JobStatus(stage=stage, message=message, started_at=datetime.utcnow())
    state.current_job = job
    project.save_state(state)

    def _wrap() -> None:
        try:
            fn()
            s = project.load_state()
            s.current_job = None
            project.save_state(s)
            logger.info("job %s/%s finished", project.slug, stage)
        except Exception as e:  # noqa: BLE001 — we want to surface any failure
            logger.exception("job %s/%s failed", project.slug, stage)
            s = project.load_state()
            s.current_job = JobStatus(
                stage=stage,
                message=f"failed: {e}",
                started_at=job.started_at,
                error=str(e),
            )
            project.save_state(s)

    _executor.submit(_wrap)
    return job
