"""Shared FastAPI dependencies."""

from __future__ import annotations

from fastapi import HTTPException

from ..project import Project


def load_project(slug: str) -> Project:
    """Resolve a project by slug, 404-ing if not found."""
    p = Project(slug)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"project '{slug}' not found")
    return p
