from datetime import datetime

from rich.console import Console

from .. import ffmpeg
from ..project import Project
from ..schemas import StageStatus

console = Console()


def run(project: Project, *, force: bool = False) -> None:
    state = project.load_state()
    stage = state.stage("mux")
    if stage.status == StageStatus.DONE and not force:
        console.print("[dim]mux already done — use --force to re-mux[/dim]")
        return

    if not project.video_track_path.exists():
        raise RuntimeError(f"missing video track: {project.video_track_path}")
    if not project.audio_track_path.exists():
        raise RuntimeError(f"missing audio track: {project.audio_track_path}")

    duration_min = state.config.target_duration_minutes
    out = project.final_dir / f"{project.slug}_{duration_min}min.mp4"
    console.print(f"[bold]mux[/bold] {project.video_track_path.name} + {project.audio_track_path.name} → {out.name}")

    stage.status = StageStatus.IN_PROGRESS
    project.save_state(state)

    try:
        ffmpeg.mux(project.video_track_path, project.audio_track_path, out)
    except Exception as e:
        stage.status = StageStatus.FAILED
        stage.error = str(e)
        project.save_state(state)
        raise

    stage.status = StageStatus.DONE
    stage.completed_at = datetime.utcnow()
    stage.artifact = str(out.relative_to(project.root))
    stage.error = None
    project.save_state(state)
    console.print(f"[green]mux[/green] → {out}")
