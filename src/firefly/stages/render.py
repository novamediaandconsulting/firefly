"""Render a named final variant from existing source files.

A "variant" is a final MP4 with its own name (e.g. "30min", "8hr_no_music").
Variants reuse the same loopable.mp4, music_bed.wav, and sfx_*.mp3 — they just
loop those source files to a different duration and apply a different audio
mix. No API calls.

Use this after the wizard has produced source files once (loop + audio stages),
when you want multiple final renders without re-spending.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from rich.console import Console

from .. import ffmpeg
from ..project import Project
from ..schemas import FinalVariant
from .audio import _find_stock_music, _safe

console = Console()

AUDIO_MODES = ("default", "no-music", "silent", "stock")


def run(
    project: Project,
    *,
    variant: str,
    duration_min: int,
    audio_mode: str = "default",
    force: bool = False,
) -> Path:
    if audio_mode not in AUDIO_MODES:
        raise RuntimeError(
            f"audio_mode must be one of {AUDIO_MODES}, got '{audio_mode}'"
        )

    final_path = project.final_dir / f"{project.slug}_{variant}.mp4"
    if final_path.exists() and not force:
        console.print(
            f"[dim]variant '{variant}' already exists at {final_path} — use --force to re-render[/dim]"
        )
        return final_path

    target_s = duration_min * 60
    plan = project.load_plan()
    mix_cfg = project.load_mix()

    # ---- video: stream-loop the existing loopable to target duration ----
    loopable = project.intermediate_dir / "loopable.mp4"
    if not loopable.exists():
        raise RuntimeError(
            f"missing {loopable} — run `firefly loop {project.slug}` first to "
            f"produce a loopable video session"
        )

    variant_video = project.intermediate_dir / f"video_track_{variant}.mp4"
    console.print(
        f"[bold]render[/bold] variant '{variant}' — {duration_min} min, audio_mode={audio_mode}"
    )
    console.print(f"  looping video to {target_s}s…")
    ffmpeg.loop_concat(loopable, variant_video, target_s)

    # ---- audio: build layer list per audio_mode ----
    layers: list[tuple[Path, float]] = []
    if audio_mode == "silent":
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
        if audio_mode == "stock":
            stock = _find_stock_music()
            if stock is None:
                raise RuntimeError(
                    "--audio-mode stock requires a music file in assets/music/"
                )
            layers.append((stock, mix_cfg.gain_for_music(0.0)))
        elif audio_mode != "no-music":
            music_bed = project.intermediate_dir / "music_bed.wav"
            if music_bed.exists():
                layers.append((music_bed, mix_cfg.gain_for_music(0.0)))

        for sfx in plan.sfx_layers:
            sfx_path = project.intermediate_dir / f"sfx_{_safe(sfx.name)}.mp3"
            if sfx_path.exists():
                layers.append((sfx_path, mix_cfg.gain_for_sfx(sfx)))

    if not layers:
        raise RuntimeError("no audio layers available — generate audio first")

    variant_audio = project.intermediate_dir / f"audio_track_{variant}.wav"
    console.print(f"  mixing {len(layers)} layer(s) to {target_s}s…")
    for path, gain in layers:
        console.print(f"    {path.stem}: {gain}dB")
    ffmpeg.mix_audio(layers, variant_audio, target_s)

    # ---- mux ----
    console.print(f"  muxing → {final_path.name}…")
    ffmpeg.mux(variant_video, variant_audio, final_path)

    # ---- register in final_variants.json ----
    variants = project.load_final_variants()
    variants.items = [v for v in variants.items if v.name != variant]
    variants.items.append(
        FinalVariant(
            name=variant,
            duration_min=duration_min,
            audio_mode=audio_mode,
            mix_snapshot=dict(mix_cfg.layer_gains),
            mp4_path=str(final_path.relative_to(project.root)),
            bytes=final_path.stat().st_size,
            created_at=datetime.utcnow(),
        )
    )
    project.save_final_variants(variants)

    console.print(f"[green]render[/green] → {final_path}")
    return final_path


def list_variants(project: Project) -> None:
    """Print the registered final variants for a project."""
    variants = project.load_final_variants()
    if not variants.items:
        console.print("[dim]no variants rendered yet[/dim]")
        return
    console.print(f"[bold]variants[/bold] for {project.slug}:")
    for v in variants.items:
        mb = v.bytes / (1024 * 1024)
        console.print(
            f"  {v.name}: {v.duration_min}min  audio={v.audio_mode}  "
            f"{mb:.0f} MB  ({v.created_at:%Y-%m-%d %H:%M})"
        )
        console.print(f"    {v.mp4_path}")
