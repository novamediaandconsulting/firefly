"""fal.ai provider — used by stage 2 (images) and stage 3 (clips)."""

from __future__ import annotations

from pathlib import Path

import fal_client
import httpx

from ..config import require_env

FAL_KEY_HINT = "Get a key at https://fal.ai/dashboard/keys (free tier available)"


def _ensure_key() -> None:
    require_env("FAL_KEY", FAL_KEY_HINT)


def generate_image(
    prompt: str,
    *,
    model: str = "fal-ai/flux-pro/v1.1",
    image_size: str = "landscape_16_9",
    seed: int | None = None,
) -> tuple[bytes, dict]:
    """Generate a single image. Returns (png_bytes, metadata)."""
    _ensure_key()
    args: dict = {
        "prompt": prompt,
        "image_size": image_size,
        "num_images": 1,
        "enable_safety_checker": True,
    }
    if seed is not None:
        args["seed"] = seed
    # Flux Pro v1.1 typically returns in 10-20s; 3 min is a generous ceiling
    # so a stuck queue at fal raises instead of hanging the worker forever.
    result = fal_client.subscribe(model, arguments=args, with_logs=False, client_timeout=180.0)
    images = result.get("images") or []
    if not images:
        raise RuntimeError(f"fal {model} returned no images: {result!r}")
    url = images[0]["url"]
    png = httpx.get(url, timeout=120).content
    return png, {"seed": result.get("seed"), "url": url}


def upload_image(path: Path) -> str:
    """Upload a local image to fal storage; returns a public URL usable as input."""
    _ensure_key()
    return fal_client.upload_file(str(path))


def generate_image_remix(
    image_url: str,
    prompt: str,
    *,
    model: str = "fal-ai/flux-pro/kontext",
    image_size: str | None = None,
) -> tuple[bytes, dict]:
    """Image-to-image with text guidance — 'here's a picture, change it like so'.

    Dispatches by model family:
      - Flux Kontext (default): 1MP output, no resolution control.
      - Bytedance Seedream v4 Edit: supports native 4K via `image_size="auto_4K"`.
    Returns (png_bytes, metadata). Caller is responsible for resizing.
    """
    _ensure_key()
    if "seedream" in model:
        args: dict = {
            "prompt": prompt,
            "image_urls": [image_url],
            "image_size": image_size or "auto_4K",
            "num_images": 1,
            "enable_safety_checker": True,
            "enhance_prompt_mode": "standard",
        }
    else:
        # Flux Kontext family — single image_url, no resolution control.
        args = {
            "prompt": prompt,
            "image_url": image_url,
            "output_format": "png",
            "safety_tolerance": "2",
        }
    result = fal_client.subscribe(model, arguments=args, with_logs=False, client_timeout=240.0)
    images = result.get("images") or []
    if not images:
        raise RuntimeError(f"fal {model} returned no images: {result!r}")
    url = images[0]["url"]
    png = httpx.get(url, timeout=120).content
    return png, {"seed": result.get("seed"), "url": url}


def generate_clip(
    image_url: str,
    prompt: str,
    *,
    model: str = "fal-ai/kling-video/v3/pro/image-to-video",
    duration: str = "5",
    negative_prompt: str = (
        "blur, distort, low quality, glitching, morphing, deformed, "
        "random sparkles, glittering particles, floating dust motes, "
        "ambient light pulses across the room, ember showers, flying sparks, "
        "snowflakes inside the room, snow indoors, lens flares"
    ),
    generate_audio: bool = False,
) -> tuple[bytes, dict]:
    """Generate a single image-to-video clip. Returns (mp4_bytes, metadata).

    For Kling v3 we want generate_audio=False — we layer our own music & SFX in
    stage 5, and disabling audio knocks ~$0.05/sec off the price.
    """
    _ensure_key()
    args = {
        "start_image_url": image_url,
        "prompt": prompt,
        "duration": duration,
        "negative_prompt": negative_prompt,
        "generate_audio": generate_audio,
    }
    # Kling v3 pro: ~6× duration empirically, so a 15s clip = ~90s wall time.
    # 8 min ceiling covers worst-case 30s chained pair generation slow path.
    result = fal_client.subscribe(model, arguments=args, with_logs=False, client_timeout=480.0)
    video = result.get("video")
    if not video or "url" not in video:
        raise RuntimeError(f"fal {model} returned no video: {result!r}")
    mp4 = httpx.get(video["url"], timeout=600).content
    return mp4, {"url": video["url"]}
