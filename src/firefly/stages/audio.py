import os
from datetime import datetime
from pathlib import Path

from rich.console import Console

from .. import ffmpeg
from ..config import ASSETS_ROOT
from ..project import Project
from ..providers import elevenlabs, music
from ..schemas import StageStatus

console = Console()

MUSIC_EXTS = {".mp3", ".wav", ".m4a", ".flac", ".ogg"}


def _find_stock_music() -> Path | None:
    music_dir = ASSETS_ROOT / "music"
    if not music_dir.is_dir():
        return None
    for p in sorted(music_dir.iterdir()):
        if p.suffix.lower() in MUSIC_EXTS:
            return p
    return None


def run(
    project: Project,
    *,
    silent: bool = False,
    stock: bool = False,
    no_music: bool = False,
    skip_sfx: bool = False,
    force: bool = False,
) -> None:
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
            layers.append((silent_path, 0.0))
        else:
            if no_music:
                console.print("[bold]audio[/bold] --no-music: SFX layers only")
            else:
                music_path = _get_music_bed(project, plan, prefer_stock=stock)
                console.print(f"[bold]audio[/bold] music bed: {music_path.name}")
                layers.append((music_path, 0.0))

            if not skip_sfx and plan and plan.sfx_layers:
                if os.getenv("ELEVENLABS_API_KEY"):
                    for sfx in plan.sfx_layers:
                        sfx_path = project.intermediate_dir / f"sfx_{_safe(sfx.name)}.mp3"
                        if not sfx_path.exists():
                            console.print(f"  generating SFX layer: {sfx.name}")
                            mp3 = elevenlabs.generate_sfx(sfx.prompt, duration_s=30.0, loop=True)
                            sfx_path.write_bytes(mp3)
                        else:
                            console.print(f"  reusing existing SFX layer: {sfx.name}")
                        layers.append((sfx_path, sfx.gain_db))
                else:
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


def _get_music_bed(project: Project, plan, *, prefer_stock: bool) -> Path:
    """Return a path to a music bed, generating via fal if needed.

    Generated music is sticky — once written to disk it is reused on every remix.
    To force regeneration, delete intermediate/music_bed.wav before running.
    """
    stock = _find_stock_music()
    if prefer_stock:
        if stock is None:
            raise RuntimeError(
                "--stock requested but no music in assets/music/. "
                "Drop an .mp3/.wav there or drop --stock to use generated music."
            )
        return stock

    state = project.load_state()
    bed = project.intermediate_dir / "music_bed.wav"
    if bed.exists():
        return bed

    if plan is None or not plan.music_mood:
        raise RuntimeError("Cannot generate music: plan.json missing or has no music_mood.")
    console.print(
        f"  generating music ({state.config.music_duration_s}s "
        f"@ {state.config.music_model})…"
    )
    audio_bytes, _meta = music.generate_music(
        plan.music_mood,
        duration_s=state.config.music_duration_s,
        model=state.config.music_model,
    )
    bed.write_bytes(audio_bytes)
    return bed


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name).lower()


def regen_sfx(
    project: Project,
    layer_name: str,
    *,
    prompt: str | None = None,
    variations: int = 3,
) -> None:
    """Generate N variations of a single SFX layer for A/B/C comparison.

    Variations land at `intermediate/sfx_<slug>_v1.mp3`, `_v2.mp3`, etc.
    The canonical `sfx_<slug>.mp3` (used in the final mix) is NOT touched —
    when you pick a winner, copy it over the canonical and re-run audio + mux.
    If `--prompt` is given, the plan's stored prompt for this layer is updated.
    """
    plan = project.load_plan()
    layer = next((l for l in plan.sfx_layers if l.name == layer_name), None)
    if layer is None:
        names = [l.name for l in plan.sfx_layers]
        raise RuntimeError(
            f"SFX layer '{layer_name}' not found. Available:\n  - "
            + "\n  - ".join(names)
        )

    used_prompt = prompt or layer.prompt
    safe = _safe(layer_name)
    console.print(
        f"[bold]regen sfx[/bold] '{layer_name}' — generating {variations} variation(s)…"
    )
    if prompt:
        console.print(f"  new prompt: {used_prompt[:120]}{'…' if len(used_prompt) > 120 else ''}")

    files: list[Path] = []
    for i in range(1, variations + 1):
        out = project.intermediate_dir / f"sfx_{safe}_v{i}.mp3"
        console.print(f"  v{i}…", end=" ")
        mp3 = elevenlabs.generate_sfx(used_prompt, duration_s=30.0, loop=True)
        out.write_bytes(mp3)
        files.append(out)
        console.print("[green]ok[/green]")

    if prompt:
        layer.prompt = used_prompt
        project.save_plan(plan)
        console.print("  updated plan.json with new prompt")

    canonical = project.intermediate_dir / f"sfx_{safe}.mp3"
    console.print(f"\n[green]done[/green] — {len(files)} variation(s) ready")
    for f in files:
        console.print(f"  {f.name}")
    console.print(
        f"\nWhen you pick one, swap it in:\n"
        f"  [cyan]cp projects/{project.slug}/intermediate/sfx_{safe}_v<N>.mp3 "
        f"projects/{project.slug}/intermediate/{canonical.name}[/cyan]\n"
        f"  [cyan]firefly audio {project.slug} --force[/cyan]\n"
        f"  [cyan]firefly mux {project.slug} --force[/cyan]"
    )
