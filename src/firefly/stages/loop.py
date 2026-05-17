from datetime import datetime

from rich.console import Console

from .. import ffmpeg
from ..project import Project
from ..schemas import StageStatus

console = Console()


def run(project: Project, *, duration_min: int | None = None, force: bool = False) -> None:
    state = project.load_state()
    stage = state.stage("loop")
    if stage.status == StageStatus.DONE and not force:
        console.print("[dim]loop already built — use --force to rebuild[/dim]")
        return

    if duration_min is not None:
        state.config.target_duration_minutes = duration_min
    target_s = state.config.target_duration_minutes * 60

    clip_manifest = project.load_clip_manifest()
    approved = [c for c in clip_manifest.items if c.approved]
    if not approved:
        raise RuntimeError(
            "No approved clips. Run `firefly approve clips <slug> <id>...` first."
        )

    console.print(
        f"[bold]loop[/bold] building {state.config.target_duration_minutes}-minute video "
        f"from {len(approved)} clip(s)…"
    )
    stage.status = StageStatus.IN_PROGRESS
    project.save_state(state)

    try:
        # MVP path: use the first approved clip. Multi-clip crossfade scheduling
        # comes in iteration 2.
        primary = approved[0]
        src = project.clips_dir / primary.filename
        loopable = project.intermediate_dir / "loopable.mp4"
        console.print(f"  making seamless loop from {primary.filename}…")
        ffmpeg.make_loopable(src, loopable, xfade_s=1.0)
        console.print(f"  looping to {target_s:.0f}s @ {state.config.resolution}…")
        ffmpeg.loop_to_duration(
            loopable, project.video_track_path, target_s,
            resolution=state.config.resolution,
        )
    except Exception as e:
        stage.status = StageStatus.FAILED
        stage.error = str(e)
        project.save_state(state)
        raise

    stage.status = StageStatus.DONE
    stage.completed_at = datetime.utcnow()
    stage.artifact = "intermediate/video_track.mp4"
    stage.error = None
    project.save_state(state)
    console.print(f"[green]loop[/green] → {project.video_track_path}")
