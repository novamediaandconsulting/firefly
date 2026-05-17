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
        f"from {len(approved)} clip(s) @ {state.config.resolution}…"
    )
    stage.status = StageStatus.IN_PROGRESS
    project.save_state(state)

    try:
        clip_paths = [project.clips_dir / c.filename for c in approved]
        session_path = project.intermediate_dir / "session.mp4"
        loopable_path = project.intermediate_dir / "loopable.mp4"

        console.print(
            f"  building session: {len(approved)} clip(s) with 1s crossfades…"
        )
        ffmpeg.build_session(
            clip_paths, session_path,
            resolution=state.config.resolution, fps=30, xfade_s=1.0,
        )
        session_dur = ffmpeg.probe_duration(session_path)
        console.print(f"    session duration: {session_dur:.1f}s")

        console.print("  wrapping session for seamless loop…")
        ffmpeg.make_loopable(session_path, loopable_path, xfade_s=1.0)

        loops = target_s / session_dur
        console.print(
            f"  looping to {target_s:.0f}s "
            f"({loops:.1f}x through the session, stream copy)…"
        )
        ffmpeg.loop_concat(loopable_path, project.video_track_path, target_s)
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
