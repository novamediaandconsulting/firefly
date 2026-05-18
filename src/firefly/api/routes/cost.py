"""Cost: per-project breakdown + recent entries."""

from __future__ import annotations

from fastapi import APIRouter

from ... import costs as costs_mod
from ...schemas import CostEntry
from ..deps import load_project

router = APIRouter(prefix="/api/projects/{slug}/cost", tags=["cost"])


@router.get("")
def get_cost_summary(slug: str) -> dict:
    proj = load_project(slug)
    return costs_mod.summarize(proj)


@router.get("/entries", response_model=list[CostEntry])
def get_cost_entries(slug: str, limit: int = 100) -> list[CostEntry]:
    proj = load_project(slug)
    entries = costs_mod.load_entries(proj)
    return entries[-limit:] if limit else entries
