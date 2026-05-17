"""Thin ffmpeg/ffprobe wrappers used by stages 4 (loop), 5 (audio), 6 (mux)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


RESOLUTIONS = {
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "4k": (3840, 2160),
}


class FfmpegError(RuntimeError):
    pass


def _ensure_binaries() -> None:
    for binary in ("ffmpeg", "ffprobe"):
        if shutil.which(binary) is None:
            raise FfmpegError(
                f"{binary} not found on PATH. Install with: brew install ffmpeg"
            )


def run(cmd: list[str], *, log: bool = True) -> None:
    """Run an ffmpeg/ffprobe command, raising FfmpegError on failure."""
    _ensure_binaries()
    if log:
        # ffmpeg is chatty; -nostats -loglevel warning keeps stderr quiet.
        pass
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        snippet = (proc.stderr or proc.stdout or "").strip().splitlines()[-15:]
        raise FfmpegError(
            f"Command failed (exit {proc.returncode}):\n  {' '.join(cmd)}\n"
            + "\n".join(f"  | {line}" for line in snippet)
        )


def probe_duration(path: Path) -> float:
    """Return media duration in seconds via ffprobe."""
    _ensure_binaries()
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json", str(path),
        ],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise FfmpegError(f"ffprobe failed on {path}: {proc.stderr}")
    return float(json.loads(proc.stdout)["format"]["duration"])


def make_loopable(src: Path, dst: Path, *, xfade_s: float = 1.0) -> None:
    """Crossfade the tail of `src` over its head, producing a seamlessly-loopable clip.

    Result has the same duration as `src`. When repeated, the boundary is hidden by
    the crossfade.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    duration = probe_duration(src)
    if duration <= xfade_s * 2:
        raise FfmpegError(
            f"Clip too short ({duration:.2f}s) for {xfade_s}s xfade loop"
        )
    body = duration - xfade_s
    # body = the first (D - X) seconds; tail = the last X seconds; head = the first X seconds.
    # xfade(tail -> head) produces an X-second segment that morphs end into start.
    # concat(body, crossfade) keeps total duration = D.
    filter_complex = (
        f"[0:v]trim=0:{body:.6f},setpts=PTS-STARTPTS[body];"
        f"[0:v]trim={body:.6f}:{duration:.6f},setpts=PTS-STARTPTS[tail];"
        f"[0:v]trim=0:{xfade_s:.6f},setpts=PTS-STARTPTS[head];"
        f"[tail][head]xfade=transition=fade:duration={xfade_s:.6f}:offset=0[seam];"
        f"[body][seam]concat=n=2:v=1:a=0[out]"
    )
    run([
        "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
        "-i", str(src),
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-an",
        str(dst),
    ])


def loop_to_duration(
    loopable: Path,
    dst: Path,
    target_s: float,
    *,
    resolution: str = "1080p",
    fps: int = 30,
) -> None:
    """Loop a loopable clip until `target_s`, re-encoded at the target resolution & fps."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    w, h = RESOLUTIONS.get(resolution.lower(), RESOLUTIONS["1080p"])
    run([
        "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
        "-stream_loop", "-1", "-i", str(loopable),
        "-t", f"{target_s:.3f}",
        "-vf", f"scale={w}:{h}:flags=lanczos,fps={fps},format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-an",
        str(dst),
    ])


def loop_audio_to_duration(src: Path, dst: Path, target_s: float) -> None:
    """Loop an audio file until `target_s` seconds, re-encoded as WAV."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
        "-stream_loop", "-1", "-i", str(src),
        "-t", f"{target_s:.3f}",
        "-ac", "2", "-ar", "48000",
        "-c:a", "pcm_s16le",
        str(dst),
    ])


def mix_audio(layers: list[tuple[Path, float]], dst: Path, target_s: float) -> None:
    """Mix multiple audio layers with per-layer gain (dB). All layers looped to target_s."""
    if not layers:
        raise FfmpegError("mix_audio: no layers provided")
    dst.parent.mkdir(parents=True, exist_ok=True)
    inputs: list[str] = []
    for path, _ in layers:
        inputs += ["-stream_loop", "-1", "-i", str(path)]
    parts = []
    for i, (_, gain_db) in enumerate(layers):
        parts.append(f"[{i}:a]volume={gain_db}dB,atrim=0:{target_s:.3f}[a{i}]")
    mix_inputs = "".join(f"[a{i}]" for i in range(len(layers)))
    parts.append(
        f"{mix_inputs}amix=inputs={len(layers)}:duration=longest:normalize=0[mix]"
    )
    filter_complex = ";".join(parts)
    run([
        "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[mix]",
        "-t", f"{target_s:.3f}",
        "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le",
        str(dst),
    ])


def make_preview(audio: Path, dst: Path, *, duration_s: float = 60.0) -> None:
    """Render a short MP3 preview from the mixed audio."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
        "-i", str(audio),
        "-t", f"{duration_s:.3f}",
        "-c:a", "libmp3lame", "-b:a", "192k",
        str(dst),
    ])


def mux(video: Path, audio: Path, dst: Path) -> None:
    """Combine video + audio into a final MP4. Re-encodes audio to AAC, copies video."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-y", "-nostats", "-loglevel", "warning",
        "-i", str(video), "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        str(dst),
    ])
