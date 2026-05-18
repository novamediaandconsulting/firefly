"""firefly CLI — entry point for all stages."""

from __future__ import annotations

import os
import sys
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from . import costs as costs_mod
from .project import Project
from .schemas import ProjectConfig, StageStatus
from .stages import audio as audio_stage
from .stages import clips as clips_stage
from .stages import images as images_stage
from .stages import loop as loop_stage
from .stages import mux as mux_stage
from .stages import plan as plan_stage
from .stages import render as render_stage

app = typer.Typer(
    no_args_is_help=True,
    add_completion=False,
    help="firefly — automated chill & cozy long-form video pipeline",
    pretty_exceptions_enable=False,
)
approve_app = typer.Typer(no_args_is_help=True, help="Mark image/clip candidates as approved.")
app.add_typer(approve_app, name="approve")
regen_app = typer.Typer(no_args_is_help=True, help="Regenerate a single artifact in place.")
app.add_typer(regen_app, name="regen")
pick_app = typer.Typer(no_args_is_help=True, help="Promote a SFX/music variation to the canonical slot.")
app.add_typer(pick_app, name="pick")
mix_app = typer.Typer(no_args_is_help=True, help="Per-layer audio mix: live preview + lock for final render.")
app.add_typer(mix_app, name="mix")

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
    count: Annotated[int, typer.Option("--count", "-n", help="Candidate images to generate.")] = 4,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Generate candidate still images via fal.ai."""
    images_stage.run(_load(slug), count=count, force=force)


# ---------- clips ----------

@app.command()
def clips(
    slug: str,
    per_image: Annotated[int, typer.Option("--per-image", "-n", help="Clips per approved image.")] = 3,
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


@regen_app.command("image")
def regen_image_cmd(
    slug: str,
    image_id: Annotated[str, typer.Argument(help="Image ID to regenerate (e.g. img_03).")],
    prompt: Annotated[str | None, typer.Option("--prompt", "-p", help="New prompt; omit to re-roll existing.")] = None,
) -> None:
    """Re-generate a single image in place. Backs up the previous version."""
    images_stage.regen(_load(slug), image_id, prompt=prompt)


@regen_app.command("clip")
def regen_clip(
    slug: str,
    clip_id: Annotated[str, typer.Argument(help="Clip ID to regenerate (e.g. img_01_01).")],
    prompt: Annotated[str | None, typer.Option("--prompt", "-p", help="New prompt; omit to re-roll existing.")] = None,
) -> None:
    """Re-generate a single clip in place. Useful during QA iteration."""
    clips_stage.regen(_load(slug), clip_id, prompt=prompt)


@regen_app.command("sfx")
def regen_sfx_cmd(
    slug: str,
    layer_name: Annotated[str, typer.Argument(help='SFX layer name from plan.json (e.g. "Babbling Brook — Foreground").')],
    prompt: Annotated[str | None, typer.Option("--prompt", "-p", help="New prompt; omit to re-roll existing.")] = None,
    variations: Annotated[int, typer.Option("--variations", "-n", help="How many variations to generate.")] = 3,
) -> None:
    """Generate N variations of a single SFX layer for A/B/C comparison."""
    audio_stage.regen_sfx(_load(slug), layer_name, prompt=prompt, variations=variations)


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
    no_music: Annotated[bool, typer.Option("--no-music", help="SFX only; no music bed.")] = False,
    skip_sfx: Annotated[bool, typer.Option("--skip-sfx", help="Music only; no SFX layers.")] = False,
    sfx_variations: Annotated[int, typer.Option("--sfx-variations", help="Variations per SFX layer on first generation (default 3).")] = 3,
    music_variations: Annotated[int, typer.Option("--music-variations", help="Music bed variations on first generation (default 3).")] = 3,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Build the long-form audio track (music + SFX).

    Default: generate N variations per layer, pick v1 as canonical. Use
    `firefly pick sfx/music` to switch winners.
    """
    audio_stage.run(
        _load(slug), silent=silent, stock=stock, no_music=no_music,
        skip_sfx=skip_sfx, sfx_variations=sfx_variations,
        music_variations=music_variations, force=force,
    )


@pick_app.command("sfx")
def pick_sfx_cmd(
    slug: str,
    layer_name: Annotated[str, typer.Argument(help='SFX layer name from plan.json (e.g. "Babbling Brook — Foreground").')],
    variation: Annotated[str, typer.Argument(help="Variation to promote (e.g. v2).")],
) -> None:
    """Promote a SFX variation to the canonical slot used in the final mix."""
    audio_stage.pick_sfx(_load(slug), layer_name, variation)


@pick_app.command("music")
def pick_music_cmd(
    slug: str,
    variation: Annotated[str, typer.Argument(help="Variation to promote (e.g. v2).")],
) -> None:
    """Promote a music variation to the canonical slot used in the final mix."""
    audio_stage.pick_music(_load(slug), variation)


def _parse_gains(layer_args: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for a in layer_args:
        if "=" not in a:
            raise typer.BadParameter(f"--layer must be 'name=db', got: {a!r}")
        name, db = a.rsplit("=", 1)
        try:
            out[name.strip()] = float(db)
        except ValueError as e:
            raise typer.BadParameter(f"gain not a number in {a!r}: {e}") from e
    return out


@mix_app.command("preview")
def mix_preview_cmd(
    slug: str,
    layer: Annotated[list[str], typer.Option("--layer", "-l", help='Override gain, e.g. -l "music=-12" -l "Babbling Brook — Foreground=0"')] = [],
    duration: Annotated[int, typer.Option("--duration", help="Preview length in seconds.")] = 60,
) -> None:
    """Render an audio preview with per-layer gain overrides (no state change)."""
    audio_stage.mix_preview(_load(slug), _parse_gains(layer), duration_s=duration)


@mix_app.command("lock")
def mix_lock_cmd(
    slug: str,
    layer: Annotated[list[str], typer.Option("--layer", "-l", help="Override gain, repeatable.")] = [],
) -> None:
    """Persist per-layer gain overrides to mix.json; final render will use them."""
    audio_stage.mix_lock(_load(slug), _parse_gains(layer))


@mix_app.command("show")
def mix_show_cmd(slug: str) -> None:
    """Print the current locked mix overrides (or 'none locked')."""
    proj = _load(slug)
    cfg = proj.load_mix()
    if not cfg.layer_gains:
        console.print("[dim]no mix overrides locked — using plan-defined gains[/dim]")
        return
    console.print(f"[bold]locked mix[/bold] for {slug}:")
    for name, gain in cfg.layer_gains.items():
        console.print(f"  {name}: {gain}dB")


@app.command()
def mux(
    slug: str,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Combine video + audio into the final MP4."""
    mux_stage.run(_load(slug), force=force)


@app.command()
def render(
    slug: str,
    variant: Annotated[str, typer.Argument(help="Variant name (e.g. '30min', '8hr_no_music').")],
    duration_min: Annotated[int, typer.Option("--duration-min", "-d", help="Final length in minutes.")] = 30,
    audio_mode: Annotated[str, typer.Option("--audio-mode", help="default | no-music | silent | stock")] = "default",
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Render a named final variant from existing source files (no API calls).

    Reuses loopable.mp4 + music_bed.wav + canonical SFX files. Apply the current
    mix.json (if locked) for gains. Multiple variants live side-by-side in
    final/ and are tracked in final_variants.json.
    """
    render_stage.run(
        _load(slug), variant=variant, duration_min=duration_min,
        audio_mode=audio_mode, force=force,
    )


@app.command()
def variants(slug: str) -> None:
    """List all named final variants registered for a project."""
    render_stage.list_variants(_load(slug))


@app.command()
def cost(slug: str) -> None:
    """Show cost breakdown for a project from costs.jsonl."""
    proj = _load(slug)
    summary = costs_mod.summarize(proj)
    console.print(
        f"[bold]{slug}[/bold] — total [green]${summary['total_usd']:.2f}[/green] "
        f"across {summary['entry_count']} API call(s)"
    )
    if not summary["entry_count"]:
        return
    t = Table(show_header=True, header_style="bold")
    t.add_column("stage")
    t.add_column("cost", justify="right")
    for stage, c in sorted(summary["by_stage"].items(), key=lambda x: -x[1]):
        t.add_row(stage, f"${c:.4f}")
    console.print(t)
    t2 = Table(show_header=True, header_style="bold")
    t2.add_column("provider")
    t2.add_column("cost", justify="right")
    for prov, c in sorted(summary["by_provider"].items(), key=lambda x: -x[1]):
        t2.add_row(prov, f"${c:.4f}")
    console.print(t2)


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
