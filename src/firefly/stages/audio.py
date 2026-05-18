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
            from ..schemas import MUSIC_GAIN_KEY
            include_music = not no_music and mix_cfg.use_music and not mix_cfg.is_disabled(MUSIC_GAIN_KEY)
            if not include_music:
                console.print(
                    "[bold]audio[/bold] music disabled: " +
                    ("--no-music" if no_music else
                     "mix.use_music=false" if not mix_cfg.use_music else
                     "music layer disabled in mix")
                )
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
                        if mix_cfg.is_disabled(sfx.name):
                            console.print(f"  {sfx.name}: disabled in mix")
                            continue
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
    write_pick(canonical, "v1")
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
    write_pick(canonical, "v1")
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
    write_pick(canonical, variation)
    console.print(f"[green]picked[/green] {var.name} → {canonical.name}")
    console.print(
        f"  next: [cyan]firefly audio {project.slug} --force && firefly mux {project.slug} --force[/cyan]"
    )


def mix_preview(
    project: Project,
    overrides: dict[str, float],
    *,
    duration_s: int = 60,
    disabled_layers: list[str] | None = None,
) -> Path:
    """Render a short audio preview with per-layer gain overrides.

    Doesn't change anything stored — just writes intermediate/mix_preview.mp3.
    Used by both the CLI and the web app's mix board. `disabled_layers` (list
    of layer names or MUSIC_GAIN_KEY) excludes those layers from the preview.
    """
    plan = project.load_plan()
    disabled = set(disabled_layers or [])
    layers: list[tuple[Path, float]] = []

    from ..schemas import MUSIC_GAIN_KEY
    music_bed = project.intermediate_dir / "music_bed.wav"
    if music_bed.exists() and MUSIC_GAIN_KEY not in disabled:
        music_gain = overrides.get(MUSIC_GAIN_KEY, overrides.get("music", 0.0))
        layers.append((music_bed, music_gain))

    for sfx in plan.sfx_layers:
        if sfx.name in disabled:
            continue
        sfx_path = project.intermediate_dir / f"sfx_{_safe(sfx.name)}.mp3"
        if sfx_path.exists():
            gain = overrides.get(sfx.name, sfx.gain_db)
            layers.append((sfx_path, gain))

    if not layers:
        raise RuntimeError("no audio layers enabled — re-enable a layer first")

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
    write_pick(canonical, variation)
    console.print(f"[green]picked[/green] {var.name} → {canonical.name}")
    console.print(
        f"  next: [cyan]firefly audio {project.slug} --force && firefly mux {project.slug} --force[/cyan]"
    )


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name).lower()


def _pick_file(canonical: Path) -> Path:
    """Sidecar file tracking which variation is currently the canonical.

    For `intermediate/sfx_brook.mp3` this is `intermediate/sfx_brook.pick`,
    containing e.g. "v2". Lets the UI show the current pick without comparing
    file bytes.
    """
    return canonical.parent / f"{canonical.stem}.pick"


def read_pick(canonical: Path) -> str | None:
    pf = _pick_file(canonical)
    return pf.read_text().strip() if pf.exists() else None


def write_pick(canonical: Path, variation: str) -> None:
    _pick_file(canonical).write_text(variation)


def list_sfx_variations(project: Project) -> list[dict]:
    """List per-layer SFX variations + current pick. Used by GET /api/.../sfx."""
    if not project.plan_path.exists():
        return []
    plan = project.load_plan()
    out = []
    for sfx in plan.sfx_layers:
        safe = _safe(sfx.name)
        canonical = project.intermediate_dir / f"sfx_{safe}.mp3"
        variations = []
        for v in range(1, 21):
            variation = project.intermediate_dir / f"sfx_{safe}_v{v}.mp3"
            if not variation.exists():
                break
            variations.append({
                "id": f"v{v}",
                "path": str(variation.relative_to(project.root)),
            })
        out.append({
            "name": sfx.name,
            "prompt": sfx.prompt,
            "gain_db": sfx.gain_db,
            "canonical_path": str(canonical.relative_to(project.root)) if canonical.exists() else None,
            "current_variation": read_pick(canonical) if canonical.exists() else None,
            "variations": variations,
        })
    return out


def ensure_all_sfx_variations(project: Project, *, variations: int = 3) -> None:
    """Generate (or reuse) N variations for every SFX layer in the plan.

    Lightweight wrapper that doesn't mix or render audio_track — purely about
    making sure intermediate/sfx_*_v*.mp3 files exist. Used by the wizard's
    SFX step.
    """
    if not os.getenv("ELEVENLABS_API_KEY"):
        raise RuntimeError(
            "ELEVENLABS_API_KEY is not set. Add it to .env. "
            "Get a key at https://elevenlabs.io/app/settings/api-keys"
        )
    plan = project.load_plan()
    for sfx in plan.sfx_layers:
        _ensure_sfx_layer(project, sfx, variations=variations)


def ensure_music_variations(project: Project, *, variations: int = 3) -> None:
    """Generate (or reuse) N music bed variations. No mix."""
    plan = project.load_plan()
    _ensure_music_bed(project, plan, prefer_stock=False, variations=variations)


def list_music_variations(project: Project) -> dict:
    """List music variations + current pick. Used by GET /api/.../music."""
    plan = project.load_plan() if project.plan_path.exists() else None
    canonical = project.intermediate_dir / "music_bed.wav"
    variations = []
    for v in range(1, 21):
        variation = project.intermediate_dir / f"music_bed_v{v}.wav"
        if not variation.exists():
            break
        variations.append({
            "id": f"v{v}",
            "path": str(variation.relative_to(project.root)),
        })
    return {
        "music_mood": plan.music_mood if plan else "",
        "canonical_path": str(canonical.relative_to(project.root)) if canonical.exists() else None,
        "current_variation": read_pick(canonical) if canonical.exists() else None,
        "variations": variations,
    }


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
