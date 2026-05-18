"""Plan: generate, read, edit (refine)."""

from __future__ import annotations

from fastapi import APIRouter

from ...schemas import Plan
from ...stages import plan as plan_stage
from ..deps import load_project

router = APIRouter(prefix="/api/projects/{slug}/plan", tags=["plan"])


@router.post("", response_model=Plan)
def generate_plan(slug: str, force: bool = False) -> Plan:
    proj = load_project(slug)
    plan_stage.run(proj, force=force)
    return proj.load_plan()


@router.get("", response_model=Plan)
def get_plan(slug: str) -> Plan:
    proj = load_project(slug)
    return proj.load_plan()


@router.put("", response_model=Plan)
def update_plan(slug: str, plan: Plan) -> Plan:
    """Replace plan.json with an edited version (used by the wizard's refine step)."""
    proj = load_project(slug)
    proj.save_plan(plan)
    return plan
