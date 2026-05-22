"""Studio job functions — called by the API routes via the background runner.

Each function:
- loads the StudioProject for a slug
- does the work (calls fal / ElevenLabs / ffmpeg)
- writes the new attempt file under attempts/<step>/v<N>.<ext>
- writes a sibling .meta.json
- updates project.json with the new Attempt
- records cost in costs.jsonl

Path conventions and project state writes are all routed through StudioStore.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

from . import costs as costs_mod
from . import ffmpeg as ff
from .providers import elevenlabs, fal, music as music_provider
from .studio import (
    Attempt,
    FinalRender,
    SfxLayer,
    StudioProject,
    StudioStore,
    attempt_meta_path,
    next_attempt_id,
)


# ---- resolution helpers -----------------------------------------------------

# Width × height (16:9) targets. Always generated at native model resolution
# then resized via ffmpeg.
_RES_TARGETS = {
    "720p":  (1280, 720),
    "1080p": (1920, 1080),
    "4k":    (3840, 2160),
}


def _resize_image(src: Path, dst: Path, target: str) -> None:
    """Bicubic resize an image via ffmpeg to the chosen target."""
    if target.lower() not in _RES_TARGETS:
        # Unknown target; just copy
        shutil.copy(src, dst)
        return
    w, h = _RES_TARGETS[target.lower()]
    ff.run([
        "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
        "-i", str(src),
        "-vf", f"scale={w}:{h}:flags=lanczos,format=yuv420p",
        "-frames:v", "1",
        str(dst),
    ])


def _write_meta(attempt_file: Path, attempt: Attempt) -> None:
    meta = {
        "id": attempt.id,
        "prompt": attempt.prompt,
        "config": attempt.config,
        "created_at": attempt.created_at.isoformat(),
        "cost_usd": attempt.cost_usd,
    }
    attempt_meta_path(attempt_file).write_text(json.dumps(meta, indent=2))


# ---- IMAGE ------------------------------------------------------------------


def generate_image(slug: str, prompt: str, resolution: str) -> Attempt:
    """Generate one image attempt and add it to the project."""
    store = StudioStore(slug)
    project = store.load()

    attempt_id = next_attempt_id(project.image.attempts)
    target_dir = store.attempt_dir("image")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / f"{attempt_id}.png"

    # Generate at native resolution (Flux Pro v1.1 ~1MP).
    png, meta = fal.generate_image(prompt, model=project.config.image_model)
    # Write native PNG to a temp path, then resize.
    raw_path = target_dir / f"{attempt_id}.raw.png"
    raw_path.write_bytes(png)
    _resize_image(raw_path, target_file, resolution)
    raw_path.unlink(missing_ok=True)

    # Record cost
    entry = costs_mod.record(
        # Use the legacy Project class only for the costs_path helper — record
        # writes to projects/<slug>/costs.jsonl which is the same path.
        _legacy_proxy(store),
        provider="fal", model=project.config.image_model,
        stage="image", artifact_id=attempt_id, units=1.0,
    )

    attempt = Attempt(
        id=attempt_id,
        filename=str(target_file.relative_to(store.root)),
        prompt=prompt,
        config={"resolution": resolution, "seed": meta.get("seed")},
        created_at=datetime.utcnow(),
        cost_usd=entry.cost_usd,
    )
    _write_meta(target_file, attempt)
    project.image.attempts.append(attempt)
    # Update the live prompt + resolution to whatever was just used.
    project.image.prompt = prompt
    project.image.resolution = resolution
    # Auto-select the new attempt so it's the canonical choice; the user can
    # override later by clicking a prior attempt in the history strip.
    project.image.chosen_attempt_id = attempt_id
    shutil.copy(target_file, store.selected_image_path())
    store.save(project)
    return attempt


def generate_image_remix(
    slug: str,
    ref_filename: str,
    prompt: str,
    resolution: str,
) -> Attempt:
    """Generate a new image by remixing an uploaded reference + text prompt.

    The uploaded reference is read from projects/<slug>/<ref_filename>, posted
    to fal via fal.upload_image, then Flux Kontext runs the edit. Result is
    saved as a normal image attempt (attempts/image/vN.png) so it slots into
    the same history strip as text-to-image generations.
    """
    store = StudioStore(slug)
    project = store.load()

    ref_path = store.root / ref_filename
    if not ref_path.exists():
        raise RuntimeError(f"reference image not found at {ref_path}")

    attempt_id = next_attempt_id(project.image.attempts)
    target_dir = store.attempt_dir("image")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / f"{attempt_id}.png"

    # Upload reference to fal, then call Kontext.
    image_url = fal.upload_image(ref_path)
    png, meta = fal.generate_image_remix(
        image_url, prompt, model=project.config.image_edit_model,
    )
    raw_path = target_dir / f"{attempt_id}.raw.png"
    raw_path.write_bytes(png)
    _resize_image(raw_path, target_file, resolution)
    raw_path.unlink(missing_ok=True)

    entry = costs_mod.record(
        _legacy_proxy(store),
        provider="fal", model=project.config.image_edit_model,
        stage="image", artifact_id=attempt_id, units=1.0,
    )

    attempt = Attempt(
        id=attempt_id,
        filename=str(target_file.relative_to(store.root)),
        prompt=prompt,
        config={
            "kind": "remix",
            "resolution": resolution,
            "reference": ref_filename,
            "seed": meta.get("seed"),
        },
        created_at=datetime.utcnow(),
        cost_usd=entry.cost_usd,
    )
    _write_meta(target_file, attempt)
    project.image.attempts.append(attempt)
    project.image.prompt = prompt
    project.image.resolution = resolution
    # Auto-select the new remix so it flows into clip step naturally.
    project.image.chosen_attempt_id = attempt_id
    shutil.copy(target_file, store.selected_image_path())
    store.save(project)
    return attempt


# ---- CLIP -------------------------------------------------------------------


def generate_clip(slug: str, motion_prompts: list[str], duration_s: int) -> Attempt:
    """Generate one clip attempt. Chains Kling calls for durations > 15s."""
    if duration_s < 1 or duration_s > 30:
        raise RuntimeError("clip duration must be between 1 and 30 seconds")
    store = StudioStore(slug)
    project = store.load()
    if not project.image.chosen_attempt_id:
        raise RuntimeError("no image confirmed yet — confirm an image first")

    image_attempt = next(
        a for a in project.image.attempts if a.id == project.image.chosen_attempt_id
    )
    image_path = store.root / image_attempt.filename
    if not image_path.exists():
        raise RuntimeError(f"chosen image not found at {image_path}")

    prompt = "\n\n".join(p for p in motion_prompts if p.strip()) or "Subtle natural motion."

    attempt_id = next_attempt_id(project.clip.attempts)
    target_dir = store.attempt_dir("clip")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / f"{attempt_id}.mp4"

    total_cost = 0.0
    if duration_s <= 15:
        image_url = fal.upload_image(image_path)
        mp4, _meta = fal.generate_clip(
            image_url, prompt,
            model=project.config.video_model,
            duration=str(duration_s),
        )
        target_file.write_bytes(mp4)
        entry = costs_mod.record(
            _legacy_proxy(store),
            provider="fal", model=project.config.video_model,
            stage="clip", artifact_id=attempt_id, units=float(duration_s),
        )
        total_cost = entry.cost_usd
    else:
        # 16-30s: chain two segments. Segment 1 = 15s; segment 2 = remaining.
        seg1_dur = 15
        seg2_dur = duration_s - 15
        seg1 = target_dir / f"{attempt_id}.seg1.mp4"
        seg2 = target_dir / f"{attempt_id}.seg2.mp4"
        last_frame = target_dir / f"{attempt_id}.lastframe.png"

        # Segment 1 — from chosen image
        image_url = fal.upload_image(image_path)
        mp4, _ = fal.generate_clip(
            image_url, prompt,
            model=project.config.video_model,
            duration=str(seg1_dur),
        )
        seg1.write_bytes(mp4)
        e1 = costs_mod.record(
            _legacy_proxy(store),
            provider="fal", model=project.config.video_model,
            stage="clip", artifact_id=f"{attempt_id}_seg1", units=float(seg1_dur),
        )
        total_cost += e1.cost_usd

        # Extract last frame of seg1
        ff.run([
            "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
            "-sseof", "-0.1", "-i", str(seg1),
            "-vsync", "0", "-q:v", "2",
            "-frames:v", "1", str(last_frame),
        ])

        # Segment 2 — from last frame of seg1
        last_url = fal.upload_image(last_frame)
        mp4, _ = fal.generate_clip(
            last_url, prompt,
            model=project.config.video_model,
            duration=str(seg2_dur),
        )
        seg2.write_bytes(mp4)
        e2 = costs_mod.record(
            _legacy_proxy(store),
            provider="fal", model=project.config.video_model,
            stage="clip", artifact_id=f"{attempt_id}_seg2", units=float(seg2_dur),
        )
        total_cost += e2.cost_usd

        # Concatenate seg1 + seg2 → target_file
        concat_list = target_dir / f"{attempt_id}.concat.txt"
        concat_list.write_text(
            f"file '{seg1.name}'\nfile '{seg2.name}'\n"
        )
        ff.run([
            "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_list),
            "-c", "copy",
            str(target_file),
        ])
        # Clean intermediates (keep segs for debug? remove for cleanliness)
        seg1.unlink(missing_ok=True)
        seg2.unlink(missing_ok=True)
        last_frame.unlink(missing_ok=True)
        concat_list.unlink(missing_ok=True)

    attempt = Attempt(
        id=attempt_id,
        filename=str(target_file.relative_to(store.root)),
        prompt=prompt,
        config={
            "duration_s": duration_s,
            "motion_prompts": motion_prompts,
            "chained": duration_s > 15,
        },
        created_at=datetime.utcnow(),
        cost_usd=total_cost,
    )
    _write_meta(target_file, attempt)
    project.clip.attempts.append(attempt)
    project.clip.motion_prompts = motion_prompts
    project.clip.duration_s = duration_s
    # Auto-select the new clip so it flows through to the mix + final render
    # without an extra explicit Pick click.
    project.clip.chosen_attempt_id = attempt_id
    shutil.copy(target_file, store.selected_clip_path())
    store.save(project)
    return attempt


# ---- SFX --------------------------------------------------------------------


def generate_sfx(slug: str, layer_id: str, title: str, prompt: str, gain_db: float) -> Attempt:
    """Generate one SFX attempt for a given layer."""
    store = StudioStore(slug)
    project = store.load()
    layer = _find_layer(project, layer_id)
    if not layer:
        raise RuntimeError(f"sfx layer '{layer_id}' not found")
    # Update layer fields to whatever was just used for this attempt.
    layer.title = title
    layer.prompt = prompt
    layer.gain_db = gain_db

    attempt_id = next_attempt_id(layer.attempts)
    target_dir = store.attempt_dir("sfx", sublayer=layer_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / f"{attempt_id}.mp3"

    mp3 = elevenlabs.generate_sfx(prompt, duration_s=30.0, loop=True)
    target_file.write_bytes(mp3)

    entry = costs_mod.record(
        _legacy_proxy(store),
        provider="elevenlabs", model="sound-generation",
        stage="sfx", artifact_id=f"{layer_id}_{attempt_id}", units=1.0,
    )
    attempt = Attempt(
        id=attempt_id,
        filename=str(target_file.relative_to(store.root)),
        prompt=prompt,
        config={"title": title, "gain_db": gain_db},
        created_at=datetime.utcnow(),
        cost_usd=entry.cost_usd,
    )
    _write_meta(target_file, attempt)
    layer.attempts.append(attempt)
    # Auto-select so the layer flows into the mix without a separate Pick.
    layer.chosen_attempt_id = attempt_id
    shutil.copy(target_file, store.selected_sfx_path(layer.layer_id))
    store.save(project)
    return attempt


# ---- MUSIC ------------------------------------------------------------------


def generate_music(slug: str, prompt: str) -> Attempt:
    store = StudioStore(slug)
    project = store.load()

    attempt_id = next_attempt_id(project.music.attempts)
    target_dir = store.attempt_dir("music")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / f"{attempt_id}.wav"

    bed_bytes, _ = music_provider.generate_music(
        prompt,
        duration_s=project.config.music_duration_s,
        model=project.config.music_model,
    )
    target_file.write_bytes(bed_bytes)

    entry = costs_mod.record(
        _legacy_proxy(store),
        provider="fal", model=project.config.music_model,
        stage="music", artifact_id=attempt_id,
        units=project.config.music_duration_s / 60.0,
    )
    attempt = Attempt(
        id=attempt_id,
        filename=str(target_file.relative_to(store.root)),
        prompt=prompt,
        config={},
        created_at=datetime.utcnow(),
        cost_usd=entry.cost_usd,
    )
    _write_meta(target_file, attempt)
    project.music.attempts.append(attempt)
    project.music.prompt = prompt
    project.music.skipped = False
    # Auto-select so the music bed flows into the mix without a separate Pick.
    project.music.chosen_attempt_id = attempt_id
    shutil.copy(target_file, store.selected_music_path())
    store.save(project)
    return attempt


# ---- MIX PREVIEW & FINAL RENDER --------------------------------------------


def render_mix_preview(slug: str, duration_s: int) -> Attempt:
    """Render a preview mix using each layer's chosen attempt + current mix config."""
    store = StudioStore(slug)
    project = store.load()

    attempt_id = next_attempt_id(project.mix.previews)
    target_dir = store.attempt_dir("mix_preview")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / f"{attempt_id}.mp3"

    layers = _build_mix_layers(project, store)
    if not layers:
        raise RuntimeError("no audio layers to preview (no SFX or music chosen yet)")

    tmp_wav = target_dir / f"{attempt_id}.wav"
    ff.mix_audio(layers, tmp_wav, float(duration_s))
    ff.make_preview(tmp_wav, target_file, duration_s=float(duration_s))
    tmp_wav.unlink(missing_ok=True)

    attempt = Attempt(
        id=attempt_id,
        filename=str(target_file.relative_to(store.root)),
        prompt="",
        config={
            "duration_s": duration_s,
            "layer_gains": dict(project.mix.layer_gains),
            "disabled_layers": list(project.mix.disabled_layers),
        },
        created_at=datetime.utcnow(),
        cost_usd=0.0,
    )
    _write_meta(target_file, attempt)
    project.mix.previews.append(attempt)
    project.mix.preview_duration_s = duration_s
    store.save(project)
    return attempt


def render_final(slug: str, duration_min: int) -> FinalRender:
    """Render the final video using chosen attempts + locked mix.

    Builds:
    - A loopable video from the chosen clip (single-clip session for now).
    - A mix audio track at the target duration using chosen SFX + music.
    - Muxes them together.
    """
    store = StudioStore(slug)
    project = store.load()

    if not project.clip.chosen_attempt_id:
        raise RuntimeError("no clip confirmed yet")
    clip_attempt = next(
        a for a in project.clip.attempts if a.id == project.clip.chosen_attempt_id
    )
    clip_path = store.root / clip_attempt.filename
    if not clip_path.exists():
        raise RuntimeError(f"chosen clip not found at {clip_path}")

    target_s = duration_min * 60
    intermediate_dir = store.root / "intermediate"
    intermediate_dir.mkdir(exist_ok=True)

    # 1. Build session (single clip → loopable) at the chosen resolution.
    session_path = intermediate_dir / "studio_session.mp4"
    loopable_path = intermediate_dir / "studio_loopable.mp4"
    ff.build_session(
        [clip_path], session_path,
        resolution=project.image.resolution,
        fps=30, xfade_s=1.0,
    )
    ff.make_loopable(session_path, loopable_path, xfade_s=1.0)

    # 2. Build video track at full duration.
    video_track = intermediate_dir / "studio_video_track.mp4"
    ff.loop_concat(loopable_path, video_track, float(target_s))

    # 3. Build audio track from chosen layers + mix.
    audio_track = intermediate_dir / "studio_audio_track.wav"
    layers = _build_mix_layers(project, store)
    if not layers:
        # No audio at all — render silent
        ff.run([
            "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-t", f"{target_s:.3f}",
            "-c:a", "pcm_s16le",
            str(audio_track),
        ])
    else:
        ff.mix_audio(layers, audio_track, float(target_s))

    # 4. Mux.
    today = datetime.utcnow().strftime("%Y%m%d")
    variant_name = f"{project.slug}_{duration_min}min_{today}"
    final_file = store.final_video_path(variant_name)
    # If variant already exists, append a numeric suffix
    n = 2
    while final_file.exists():
        variant_name = f"{project.slug}_{duration_min}min_{today}-{n}"
        final_file = store.final_video_path(variant_name)
        n += 1
    ff.mux(video_track, audio_track, final_file)

    render_id = f"r{len(project.final.renders) + 1}"
    bytes_ = final_file.stat().st_size
    render = FinalRender(
        id=render_id,
        variant_name=variant_name,
        duration_min=duration_min,
        filename=str(final_file.relative_to(store.root)),
        bytes=bytes_,
        created_at=datetime.utcnow(),
    )
    project.final.renders.append(render)
    project.final.chosen_render_id = render_id
    project.final.duration_min = duration_min
    store.save(project)
    return render


# ---- Selection / confirmation -----------------------------------------------


def select_image(slug: str, attempt_id: str) -> Attempt:
    store = StudioStore(slug)
    project = store.load()
    attempt = _require_attempt(project.image.attempts, attempt_id, "image")
    project.image.chosen_attempt_id = attempt_id
    # Copy the chosen attempt to the top-level final_image.png for filesystem clarity
    shutil.copy(store.root / attempt.filename, store.selected_image_path())
    store.save(project)
    return attempt


def select_clip(slug: str, attempt_id: str) -> Attempt:
    store = StudioStore(slug)
    project = store.load()
    attempt = _require_attempt(project.clip.attempts, attempt_id, "clip")
    project.clip.chosen_attempt_id = attempt_id
    shutil.copy(store.root / attempt.filename, store.selected_clip_path())
    store.save(project)
    return attempt


def select_sfx(slug: str, layer_id: str, attempt_id: str) -> Attempt:
    store = StudioStore(slug)
    project = store.load()
    layer = _find_layer(project, layer_id)
    if not layer:
        raise RuntimeError(f"sfx layer '{layer_id}' not found")
    attempt = _require_attempt(layer.attempts, attempt_id, f"sfx/{layer_id}")
    layer.chosen_attempt_id = attempt_id
    shutil.copy(store.root / attempt.filename, store.selected_sfx_path(layer_id))
    store.save(project)
    return attempt


def select_music(slug: str, attempt_id: str) -> Attempt:
    store = StudioStore(slug)
    project = store.load()
    attempt = _require_attempt(project.music.attempts, attempt_id, "music")
    project.music.chosen_attempt_id = attempt_id
    project.music.skipped = False
    shutil.copy(store.root / attempt.filename, store.selected_music_path())
    store.save(project)
    return attempt


def skip_music(slug: str) -> StudioProject:
    store = StudioStore(slug)
    project = store.load()
    project.music.skipped = True
    project.music.chosen_attempt_id = None
    # Remove top-level final_music.wav if present
    if store.selected_music_path().exists():
        store.selected_music_path().unlink()
    store.save(project)
    return project


# ---- internal helpers -------------------------------------------------------


def _build_mix_layers(project: StudioProject, store: StudioStore) -> list[tuple[Path, float]]:
    """Return list of (file_path, gain_db) tuples to feed into ff.mix_audio.

    Defensive: if a layer has attempts but no chosen_attempt_id (pre-auto-
    select projects), fall back to the latest attempt rather than silently
    dropping it. Matches the frontend mix board's fallback.
    """
    from .schemas import MUSIC_GAIN_KEY
    layers: list[tuple[Path, float]] = []
    disabled = set(project.mix.disabled_layers)

    # Music
    if not project.music.skipped and MUSIC_GAIN_KEY not in disabled:
        music_attempt = None
        if project.music.chosen_attempt_id:
            music_attempt = next(
                (a for a in project.music.attempts if a.id == project.music.chosen_attempt_id),
                None,
            )
        if music_attempt is None and project.music.attempts:
            music_attempt = project.music.attempts[-1]
        if music_attempt:
            gain = project.mix.layer_gains.get(MUSIC_GAIN_KEY, 0.0)
            layers.append((store.root / music_attempt.filename, gain))

    # SFX
    for layer in project.sfx.layers:
        if layer.deleted or not layer.enabled_in_mix or layer.layer_id in disabled:
            continue
        if not layer.attempts:
            continue
        sfx_attempt = None
        if layer.chosen_attempt_id:
            sfx_attempt = next(
                (a for a in layer.attempts if a.id == layer.chosen_attempt_id),
                None,
            )
        if sfx_attempt is None:
            sfx_attempt = layer.attempts[-1]
        gain = project.mix.layer_gains.get(layer.layer_id, layer.gain_db)
        layers.append((store.root / sfx_attempt.filename, gain))

    return layers


def _find_layer(project: StudioProject, layer_id: str) -> SfxLayer | None:
    for layer in project.sfx.layers:
        if layer.layer_id == layer_id and not layer.deleted:
            return layer
    return None


def _require_attempt(attempts: list[Attempt], attempt_id: str, where: str) -> Attempt:
    for a in attempts:
        if a.id == attempt_id:
            return a
    raise RuntimeError(f"attempt '{attempt_id}' not found in {where}")


def _legacy_proxy(store: StudioStore):
    """Adapter object for costs.record() which expects a legacy Project with .costs_path."""
    class _Proxy:
        slug = store.slug
        costs_path = store.costs_path
    return _Proxy()


__all__ = [
    "generate_image",
    "generate_clip",
    "generate_sfx",
    "generate_music",
    "render_mix_preview",
    "render_final",
    "select_image",
    "select_clip",
    "select_sfx",
    "select_music",
    "skip_music",
]
