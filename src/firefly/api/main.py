"""FastAPI service that wraps the firefly pipeline.

Endpoints are thin wrappers over `src/firefly/stages/*` — the CLI and the web app
both call the same Python functions. Run locally with `firefly api`.

CORS is open to localhost:3000 (Next.js dev). Files at `/files/<slug>/...` are
served directly from `projects/<slug>/`.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from ..config import PROJECTS_ROOT
from ..project import Project
from ..schemas import JobStatus

logger = logging.getLogger("firefly.api")
from .routes import (
    audio as audio_routes,
    clips as clips_routes,
    cost as cost_routes,
    images as images_routes,
    mix as mix_routes,
    plan as plan_routes,
    projects as projects_routes,
    render as render_routes,
)


def create_app() -> FastAPI:
    app = FastAPI(
        title="firefly",
        version="0.1.0",
        description="Local pipeline service for cozy/ambient video generation.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:3001",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Friendly error → 400 with the message; unknown errors → 500 with class name.
    @app.exception_handler(FileNotFoundError)
    async def not_found_handler(_: Request, exc: FileNotFoundError):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(RuntimeError)
    async def runtime_error_handler(_: Request, exc: RuntimeError):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.on_event("startup")
    def _clear_stale_jobs() -> None:
        """Mark any current_job left over from a prior server run as interrupted.

        Without this, a worker thread that died mid-run (e.g. server kill, OS
        crash) would leave current_job set forever, blocking new jobs with 409.
        """
        if not PROJECTS_ROOT.is_dir():
            return
        cleared = 0
        for child in PROJECTS_ROOT.iterdir():
            if not (child / "state.json").exists():
                continue
            try:
                proj = Project(child.name)
                state = proj.load_state()
                if state.current_job and not state.current_job.error:
                    state.current_job = JobStatus(
                        stage=state.current_job.stage,
                        message="interrupted by server restart",
                        started_at=state.current_job.started_at,
                        error="interrupted by server restart",
                    )
                    proj.save_state(state)
                    cleared += 1
            except Exception:
                logger.exception("failed to clear stale job for %s", child.name)
        if cleared:
            logger.info("marked %d stale job(s) as interrupted", cleared)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "projects_root": str(PROJECTS_ROOT.resolve())}

    app.include_router(projects_routes.router)
    app.include_router(plan_routes.router)
    app.include_router(images_routes.router)
    app.include_router(clips_routes.router)
    app.include_router(audio_routes.router)
    app.include_router(mix_routes.router)
    app.include_router(render_routes.router)
    app.include_router(cost_routes.router)

    # File serving: projects/<slug>/... is reachable at /files/<slug>/...
    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
    app.mount("/files", StaticFiles(directory=str(PROJECTS_ROOT)), name="files")

    return app


app = create_app()
