"""FastAPI service that wraps the firefly pipeline.

Endpoints are thin wrappers over `src/firefly/stages/*` — the CLI and the web app
both call the same Python functions. Run locally with `firefly api`.

CORS is open to localhost:3000 (Next.js dev). Files at `/files/<slug>/...` are
served directly from `projects/<slug>/`.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from ..config import PROJECTS_ROOT
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
