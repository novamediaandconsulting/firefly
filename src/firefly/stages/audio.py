import os
from datetime import datetime
from pathlib import Path

from rich.console import Console

from .. import ffmpeg
from ..config import ASSETS_ROOT
from ..project import Project
from ..providers import elevenlabs
from ..schemas import StageStatus

console = Console()

MUSIC_EXTS = {".mp3", ".wav", ".m4a", ".flac", ".ogg"}


def _find_music() -> Path | None:
    music_dir = ASSETS_ROOT / "music"
    if not music_dir.is_dir():
        return None
    for p in sorted(music_dir.iterdir()):
        if p.suffix.lower() in MUSIC_EXTS:
            return p
    return None


def run(project: Project, *, silent: bool = False, skip_sfx: bool = False, force: bool = False) -> None:
    state = project.load_state()
    stage = state.stage("audio")
    if stage.status == StageStatus.DONE and not force:
        console.print("[dim]audio already mixed — use --force to remix[/dim]")
        return

    target_s = state.config.target_duration_minutes * 60
    plan = project.load_plan() if project.plan_path.exists() else None

    stage.status = StageStatus.IN_PROGRESS
    project.save_state(state)

    try:
        layers: list[tuple[Path, float]] = []

        if silent:
            console.print("[bold]audio[/bold] --silent: generating silent track")
            silent_path = project.intermediate_dir / "silence.wav"
            ffmpeg.run([
                "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
                "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
                "-t", f"{target_s:.3f}",
                "-c:a", "pcm_s16le",
                str(silent_path),
            ])
            # Use silence as a single layer so the rest of the pipeline is uniform.
            layers.append((silent_path, 0.0))
        else:
            music = _find_music()
            if music is None:
                raise RuntimeError(
                    "No music file found in assets/music/. Drop a .mp3/.wav there, "
                    "or pass --silent to skip music."
                )
            console.print(f"[bold]audio[/bold] music bed: {music.name}")
            layers.append((music, 0.0))

            if not skip_sfx and plan and plan.sfx_layers and os.getenv("ELEVENLABS_API_KEY"):
                for sfx in plan.sfx_layers:
                    sfx_path = project.intermediate_dir / f"sfx_{_safe(sfx.name)}.mp3"
                    if not sfx_path.exists() or force:
                        console.print(f"  generating SFX layer: {sfx.name}")
                        mp3 = elevenlabs.generate_sfx(sfx.prompt, duration_s=22.0)
                        sfx_path.write_bytes(mp3)
                    layers.append((sfx_path, sfx.gain_db))
            elif not skip_sfx and plan and plan.sfx_layers:
                console.print(
                    "  [yellow]skipping SFX layers: ELEVENLABS_API_KEY not set[/yellow]"
                )

        console.print(f"  mixing {len(layers)} layer(s) to {target_s:.0f}s…")
        ffmpeg.mix_audio(layers, project.audio_track_path, target_s)
        console.print("  rendering 60s preview…")
        ffmpeg.make_preview(project.audio_track_path, project.audio_preview_path)
    except Exception as e:
        stage.status = StageStatus.FAILED
        stage.error = str(e)
        project.save_state(state)
        raise

    stage.status = StageStatus.DONE
    stage.completed_at = datetime.utcnow()
    stage.artifact = "intermediate/audio_track.wav"
    stage.error = None
    project.save_state(state)
    console.print(f"[green]audio[/green] → {project.audio_track_path}")
    console.print(f"  preview: {project.audio_preview_path}")


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name).lower()
