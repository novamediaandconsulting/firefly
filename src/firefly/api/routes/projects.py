"""Projects: list, create (init), read state, delete."""

from __future__ import annotations

import shutil
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...config import PROJECTS_ROOT
from ...project import Project
from ...schemas import ProjectConfig, State
from ..deps import load_project

router = APIRouter(prefix="/api/projects", tags=["projects"])


class CreateProjectRequest(BaseModel):
    slug: str
    concept: str
    duration_min: int = 30
    resolution: str = "1080p"
    plan_model: str = "claude-sonnet-4-6"


class ProjectSummary(BaseModel):
    slug: str
    concept: str
    created_at: datetime
    target_duration_minutes: int
    resolution: str
    stage_progress: dict[str, str]  # stage_name -> status string


def _summarize(state: State) -> ProjectSummary:
    return ProjectSummary(
        slug=state.slug,
        concept=state.concept,
        created_at=state.created_at,
        target_duration_minutes=state.config.target_duration_minutes,
        resolution=state.config.resolution,
        stage_progress={name: s.status.value for name, s in state.stages.items()},
    )


@router.get("", response_model=list[ProjectSummary])
def list_projects() -> list[ProjectSummary]:
    if not PROJECTS_ROOT.exists():
        return []
    out: list[ProjectSummary] = []
    for child in sorted(PROJECTS_ROOT.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not child.is_dir():
            continue
        state_file = child / "state.json"
        if not state_file.exists():
            continue
        try:
            state = State.model_validate_json(state_file.read_text())
            out.append(_summarize(state))
        except Exception:
            continue  # skip malformed projects
    return out


@router.post("", response_model=State, status_code=201)
def create_project(req: CreateProjectRequest) -> State:
    p = Project(req.slug)
    if p.exists():
        raise HTTPException(409, f"project '{req.slug}' already exists")
    cfg = ProjectConfig(
        target_duration_minutes=req.duration_min,
        resolution=req.resolution,
        plan_model=req.plan_model,
    )
    return p.create(req.concept, cfg)


@router.get("/{slug}", response_model=State)
def get_project(slug: str) -> State:
    proj = load_project(slug)
    return proj.load_state()


@router.delete("/{slug}", status_code=204)
def delete_project(slug: str, confirm: bool = False) -> None:
    if not confirm:
        raise HTTPException(400, "pass ?confirm=true to actually delete the project")
    proj = load_project(slug)
    shutil.rmtree(proj.root)
