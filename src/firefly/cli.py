"""firefly CLI — entry point for all stages."""

from __future__ import annotations

import os
import sys
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from .project import Project
from .schemas import ProjectConfig, StageStatus
from .stages import audio as audio_stage
from .stages import clips as clips_stage
from .stages import images as images_stage
from .stages import loop as loop_stage
from .stages import mux as mux_stage
from .stages import plan as plan_stage

app = typer.Typer(
    no_args_is_help=True,
    add_completion=False,
    help="firefly — automated chill & cozy long-form video pipeline",
    pretty_exceptions_enable=False,
)
approve_app = typer.Typer(no_args_is_help=True, help="Mark image/clip candidates as approved.")
app.add_typer(approve_app, name="approve")

console = Console()


def _load(slug: str) -> Project:
    p = Project(slug)
    if not p.exists():
        raise typer.BadParameter(f"project '{slug}' not found at {p.root}")
    return p


# ---------- init ----------

@app.command()
def init(
    slug: Annotated[str, typer.Argument(help="Short project slug (filesystem-safe).")],
    concept: Annotated[str, typer.Argument(help="One-line scene concept.")],
    duration_min: Annotated[int, typer.Option("--duration-min", help="Target output duration, minutes.")] = 480,
    resolution: Annotated[str, typer.Option("--resolution", help="720p, 1080p, or 4k.")] = "1080p",
    plan_model: Annotated[str, typer.Option("--plan-model", help="Claude model for planning.")] = "claude-sonnet-4-6",
) -> None:
    """Create a new project folder + state.json (does not call any APIs)."""
    p = Project(slug)
    if p.exists():
        raise typer.BadParameter(f"project '{slug}' already exists at {p.root}")
    cfg = ProjectConfig(
        target_duration_minutes=duration_min,
        resolution=resolution,
        plan_model=plan_model,
    )
    p.create(concept, cfg)
    console.print(f"[green]init[/green] → {p.root}")
    console.print(f"  next: [cyan]firefly plan {slug}[/cyan]")


# ---------- plan ----------

@app.command()
def plan(
    slug: str,
    force: Annotated[bool, typer.Option("--force", help="Regenerate even if done.")] = False,
) -> None:
    """Generate plan.json with Claude."""
    plan_stage.run(_load(slug), force=force)


# ---------- images ----------

@app.command()
def images(
    slug: str,
    count: Annotated[int, typer.Option("--count", "-n", help="Candidate images to generate.")] = 6,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Generate candidate still images via fal.ai."""
    images_stage.run(_load(slug), count=count, force=force)


# ---------- clips ----------

@app.command()
def clips(
    slug: str,
    per_image: Annotated[int, typer.Option("--per-image", "-n", help="Clips per approved image.")] = 4,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Generate image-to-video clips via fal.ai for each approved image."""
    clips_stage.run(_load(slug), per_image=per_image, force=force)


# ---------- approve ----------

@approve_app.command("images")
def approve_images(
    slug: str,
    ids: Annotated[list[str], typer.Argument(help="Image IDs to approve (e.g. img_01 img_03).")],
) -> None:
    """Mark image candidates as approved."""
    proj = _load(slug)
    m = proj.load_image_manifest()
    found = set()
    for item in m.items:
        if item.id in ids:
            item.approved = True
            found.add(item.id)
    missing = set(ids) - found
    if missing:
        raise typer.BadParameter(f"unknown image IDs: {sorted(missing)}")
    proj.save_image_manifest(m)
    state = proj.load_state()
    state.stage("images").status = StageStatus.DONE
    proj.save_state(state)
    console.print(f"[green]approved[/green] {len(found)} image(s): {sorted(found)}")


@approve_app.command("clips")
def approve_clips(
    slug: str,
    ids: Annotated[list[str], typer.Argument(help="Clip IDs to approve (e.g. clip_001 clip_004).")],
) -> None:
    """Mark clip candidates as approved."""
    proj = _load(slug)
    m = proj.load_clip_manifest()
    found = set()
    for item in m.items:
        if item.id in ids:
            item.approved = True
            found.add(item.id)
    missing = set(ids) - found
    if missing:
        raise typer.BadParameter(f"unknown clip IDs: {sorted(missing)}")
    proj.save_clip_manifest(m)
    state = proj.load_state()
    state.stage("clips").status = StageStatus.DONE
    proj.save_state(state)
    console.print(f"[green]approved[/green] {len(found)} clip(s): {sorted(found)}")


# ---------- loop / audio / mux ----------

@app.command()
def loop(
    slug: str,
    duration_min: Annotated[int | None, typer.Option("--duration-min", help="Override target duration.")] = None,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Build the silent long-form video track from approved clips."""
    loop_stage.run(_load(slug), duration_min=duration_min, force=force)


@app.command()
def audio(
    slug: str,
    silent: Annotated[bool, typer.Option("--silent", help="Skip music & SFX; produce silence.")] = False,
    stock: Annotated[bool, typer.Option("--stock", help="Use stock music in assets/music/ instead of generating.")] = False,
    skip_sfx: Annotated[bool, typer.Option("--skip-sfx", help="Music only; no SFX layers.")] = False,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Build the long-form audio track (music + SFX).

    Default: generate music via fal (CassetteAI), layer SFX via ElevenLabs.
    """
    audio_stage.run(_load(slug), silent=silent, stock=stock, skip_sfx=skip_sfx, force=force)


@app.command()
def mux(
    slug: str,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Combine video + audio into the final MP4."""
    mux_stage.run(_load(slug), force=force)


# ---------- status ----------

@app.command()
def status(slug: str) -> None:
    """Show the state of a project."""
    proj = _load(slug)
    state = proj.load_state()
    console.print(f"[bold]{state.slug}[/bold]  ({state.config.target_duration_minutes} min, {state.config.resolution})")
    console.print(f"  concept: {state.concept}")
    console.print(f"  created: {state.created_at:%Y-%m-%d %H:%M}")
    t = Table(show_header=True, header_style="bold")
    t.add_column("stage")
    t.add_column("status")
    t.add_column("artifact")
    for name, s in state.stages.items():
        color = {
            StageStatus.DONE: "green",
            StageStatus.AWAITING_QA: "yellow",
            StageStatus.IN_PROGRESS: "cyan",
            StageStatus.FAILED: "red",
            StageStatus.PENDING: "dim",
        }[s.status]
        t.add_row(name, f"[{color}]{s.status.value}[/{color}]", s.artifact or "-")
    console.print(t)
    if state.stage("images").status == StageStatus.AWAITING_QA:
        m = proj.load_image_manifest()
        console.print(f"  images: {len(m.items)} candidates — approve some to proceed")
    if state.stage("clips").status == StageStatus.AWAITING_QA:
        m = proj.load_clip_manifest()
        console.print(f"  clips: {len(m.items)} candidates — approve some to proceed")


def main() -> None:
    """Entry point with friendly error handling. Set FIREFLY_DEBUG=1 for tracebacks."""
    try:
        app()
    except KeyboardInterrupt:
        console.print("\n[yellow]interrupted[/yellow]", style=None)
        sys.exit(130)
    except (typer.Exit, SystemExit):
        raise
    except Exception as e:
        if os.getenv("FIREFLY_DEBUG"):
            raise
        msg = str(e).strip() or e.__class__.__name__
        console.print(f"[red bold]error:[/red bold] {msg}")
        console.print("[dim](FIREFLY_DEBUG=1 for full traceback)[/dim]")
        sys.exit(1)


if __name__ == "__main__":
    main()
