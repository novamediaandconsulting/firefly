import os
import shutil
from datetime import datetime
from pathlib import Path

from rich.console import Console

from .. import costs, ffmpeg
from ..config import ASSETS_ROOT
from ..project import Project
from ..providers import elevenlabs, music
from ..schemas import MixConfig, SFXLayer, StageStatus

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
    sfx_variations: int = 3,
    music_variations: int = 3,
    force: bool = False,
) -> None:
    state = project.load_state()
    stage = state.stage("audio")
    if stage.status == StageStatus.DONE and not force:
        console.print("[dim]audio already mixed — use --force to remix[/dim]")
        return

    target_s = state.config.target_duration_minutes * 60
    plan = project.load_plan() if project.plan_path.exists() else None
    mix_cfg = project.load_mix()

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
                music_path = _ensure_music_bed(
                    project, plan, prefer_stock=stock, variations=music_variations
                )
                music_gain = mix_cfg.gain_for_music(0.0)
                console.print(f"[bold]audio[/bold] music bed: {music_path.name} @ {music_gain}dB")
                layers.append((music_path, music_gain))

            if not skip_sfx and plan and plan.sfx_layers:
                if os.getenv("ELEVENLABS_API_KEY"):
                    for sfx in plan.sfx_layers:
                        sfx_path = _ensure_sfx_layer(project, sfx, variations=sfx_variations)
                        gain = mix_cfg.gain_for_sfx(sfx)
                        if gain != sfx.gain_db:
                            console.print(f"  {sfx.name}: {sfx.gain_db}dB (plan) → {gain}dB (mix override)")
                        layers.append((sfx_path, gain))
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


def _ensure_music_bed(
    project: Project,
    plan,
    *,
    prefer_stock: bool,
    variations: int,
) -> Path:
    """Return the canonical music_bed.wav, generating variations if needed.

    Generates N variations on first run; copies v1 over the canonical. To
    switch winners later, run `firefly pick music <slug> v<N>` then `audio --force`.
    """
    stock = _find_stock_music()
    if prefer_stock:
        if stock is None:
            raise RuntimeError(
                "--stock requested but no music in assets/music/. "
                "Drop an .mp3/.wav there or drop --stock to use generated music."
            )
        return stock

    canonical = project.intermediate_dir / "music_bed.wav"
    if canonical.exists():
        return canonical
    if plan is None or not plan.music_mood:
        raise RuntimeError("Cannot generate music: plan.json missing or has no music_mood.")

    state = project.load_state()
    dur = state.config.music_duration_s
    model = state.config.music_model

    if variations <= 1:
        console.print(f"  generating music ({dur}s @ {model})…")
        audio_bytes, _ = music.generate_music(plan.music_mood, duration_s=dur, model=model)
        canonical.write_bytes(audio_bytes)
        costs.record(
            project, provider="fal", model=model, stage="audio",
            artifact_id="music_bed", units=dur / 60.0,
        )
        return canonical

    console.print(f"  generating {variations} music variation(s) ({dur}s @ {model})…")
    for v in range(1, variations + 1):
        variation = project.intermediate_dir / f"music_bed_v{v}.wav"
        if variation.exists():
            console.print(f"    v{v} exists, skipping")
            continue
        console.print(f"    v{v}…", end=" ")
        audio_bytes, _ = music.generate_music(plan.music_mood, duration_s=dur, model=model)
        variation.write_bytes(audio_bytes)
        costs.record(
            project, provider="fal", model=model, stage="audio",
            artifact_id=f"music_bed_v{v}", units=dur / 60.0,
        )
        console.print("[green]ok[/green]")

    shutil.copy(project.intermediate_dir / "music_bed_v1.wav", canonical)
    console.print(
        f"  using v1 as canonical "
        f"(switch with: [cyan]firefly pick music {project.slug} v<N>[/cyan])"
    )
    return canonical


def _ensure_sfx_layer(project: Project, sfx: SFXLayer, *, variations: int) -> Path:
    """Return canonical sfx_<safe>.mp3 for a layer, generating variations if needed.

    Mirrors the music flow: N variations on first run, v1 as canonical default.
    Switch winners later with `firefly pick sfx <slug> "<layer>" v<N>`.
    """
    safe = _safe(sfx.name)
    canonical = project.intermediate_dir / f"sfx_{safe}.mp3"
    if canonical.exists():
        console.print(f"  reusing existing SFX layer: {sfx.name}")
        return canonical

    if variations <= 1:
        console.print(f"  generating SFX layer: {sfx.name}")
        mp3 = elevenlabs.generate_sfx(sfx.prompt, duration_s=30.0, loop=True)
        canonical.write_bytes(mp3)
        costs.record(
            project, provider="elevenlabs", model="sound-generation",
            stage="audio", artifact_id=f"sfx_{safe}", units=1.0,
        )
        return canonical

    console.print(f"  generating {variations} variation(s) for: {sfx.name}")
    for v in range(1, variations + 1):
        variation = project.intermediate_dir / f"sfx_{safe}_v{v}.mp3"
        if variation.exists():
            console.print(f"    v{v} exists, skipping")
            continue
        console.print(f"    v{v}…", end=" ")
        mp3 = elevenlabs.generate_sfx(sfx.prompt, duration_s=30.0, loop=True)
        variation.write_bytes(mp3)
        costs.record(
            project, provider="elevenlabs", model="sound-generation",
            stage="audio", artifact_id=f"sfx_{safe}_v{v}", units=1.0,
        )
        console.print("[green]ok[/green]")

    shutil.copy(project.intermediate_dir / f"sfx_{safe}_v1.mp3", canonical)
    console.print(
        f"  using v1 as canonical for '{sfx.name}' "
        f"(switch with: [cyan]firefly pick sfx {project.slug} \"{sfx.name}\" v<N>[/cyan])"
    )
    return canonical


def pick_sfx(project: Project, layer_name: str, variation: str) -> None:
    """Swap a SFX variation into the canonical slot (backs up the previous canonical)."""
    plan = project.load_plan()
    layer = next((l for l in plan.sfx_layers if l.name == layer_name), None)
    if layer is None:
        names = [l.name for l in plan.sfx_layers]
        raise RuntimeError(
            f"SFX layer '{layer_name}' not found. Available:\n  - " + "\n  - ".join(names)
        )
    safe = _safe(layer_name)
    var = project.intermediate_dir / f"sfx_{safe}_{variation}.mp3"
    if not var.exists():
        raise RuntimeError(f"variation file not found: {var}")
    canonical = project.intermediate_dir / f"sfx_{safe}.mp3"
    if canonical.exists():
        ts = int(datetime.utcnow().timestamp())
        backup = canonical.with_suffix(f".bak{ts}.mp3")
        canonical.rename(backup)
        console.print(f"  backed up canonical → {backup.name}")
    shutil.copy(var, canonical)
    console.print(f"[green]picked[/green] {var.name} → {canonical.name}")
    console.print(
        f"  next: [cyan]firefly audio {project.slug} --force && firefly mux {project.slug} --force[/cyan]"
    )


def mix_preview(
    project: Project,
    overrides: dict[str, float],
    *,
    duration_s: int = 60,
) -> Path:
    """Render a short audio preview with per-layer gain overrides.

    Doesn't change anything stored — just writes intermediate/mix_preview.mp3.
    Used by both the CLI and the web app's mix board.
    """
    plan = project.load_plan()
    layers: list[tuple[Path, float]] = []

    music_bed = project.intermediate_dir / "music_bed.wav"
    if music_bed.exists():
        from ..schemas import MUSIC_GAIN_KEY
        music_gain = overrides.get(MUSIC_GAIN_KEY, overrides.get("music", 0.0))
        layers.append((music_bed, music_gain))

    for sfx in plan.sfx_layers:
        sfx_path = project.intermediate_dir / f"sfx_{_safe(sfx.name)}.mp3"
        if sfx_path.exists():
            gain = overrides.get(sfx.name, sfx.gain_db)
            layers.append((sfx_path, gain))

    if not layers:
        raise RuntimeError("no audio layers available — generate audio first")

    console.print(f"[bold]mix preview[/bold] mixing {len(layers)} layer(s) for {duration_s}s:")
    for path, gain in layers:
        console.print(f"  {path.stem}: {gain}dB")

    tmp_wav = project.intermediate_dir / "mix_preview.wav"
    ffmpeg.mix_audio(layers, tmp_wav, duration_s)
    ffmpeg.make_preview(tmp_wav, project.mix_preview_path, duration_s=duration_s)
    tmp_wav.unlink(missing_ok=True)
    console.print(f"[green]preview[/green] → {project.mix_preview_path}")
    return project.mix_preview_path


def mix_lock(project: Project, overrides: dict[str, float]) -> None:
    """Persist per-layer gain overrides to mix.json so the final render uses them."""
    cfg = MixConfig(layer_gains=overrides)
    project.save_mix(cfg)
    console.print(f"[green]locked[/green] mix → {project.mix_path}")
    for name, gain in overrides.items():
        console.print(f"  {name}: {gain}dB")
    console.print(
        f"  next: [cyan]firefly audio {project.slug} --force "
        f"&& firefly mux {project.slug} --force[/cyan]"
    )


def pick_music(project: Project, variation: str) -> None:
    """Swap a music variation into the canonical slot."""
    var = project.intermediate_dir / f"music_bed_{variation}.wav"
    if not var.exists():
        raise RuntimeError(f"variation file not found: {var}")
    canonical = project.intermediate_dir / "music_bed.wav"
    if canonical.exists():
        ts = int(datetime.utcnow().timestamp())
        backup = canonical.with_suffix(f".bak{ts}.wav")
        canonical.rename(backup)
        console.print(f"  backed up canonical → {backup.name}")
    shutil.copy(var, canonical)
    console.print(f"[green]picked[/green] {var.name} → {canonical.name}")
    console.print(
        f"  next: [cyan]firefly audio {project.slug} --force && firefly mux {project.slug} --force[/cyan]"
    )


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
    pick a winner with `firefly pick sfx <slug> "<layer>" v<N>`, then run
    `audio --force && mux --force`.
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
        costs.record(
            project, provider="elevenlabs", model="sound-generation",
            stage="audio", artifact_id=f"sfx_{safe}_v{i}", units=1.0,
        )
        files.append(out)
        console.print("[green]ok[/green]")

    if prompt:
        layer.prompt = used_prompt
        project.save_plan(plan)
        console.print("  updated plan.json with new prompt")

    console.print(f"\n[green]done[/green] — {len(files)} variation(s) ready")
    for f in files:
        console.print(f"  {f.name}")
    console.print(
        f"\nPick a winner with:\n"
        f"  [cyan]firefly pick sfx {project.slug} \"{layer_name}\" v<N>[/cyan]\n"
        f"  [cyan]firefly audio {project.slug} --force && firefly mux {project.slug} --force[/cyan]"
    )
