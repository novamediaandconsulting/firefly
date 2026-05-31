"""Cost tracking — append-only log per project + simple summarizer.

Stages call `costs.record(project, ...)` after every billable API call.
Numbers come from a pricing table here; update when providers change rates.

The log lives at `projects/<slug>/costs.jsonl` — one CostEntry per line so it's
diff-friendly and tail-able. Never edit by hand; always append via record().
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from .schemas import CostEntry

if TYPE_CHECKING:  # avoid circular import at runtime
    from .project import Project


@dataclass
class Price:
    unit: str            # "image" | "sec_video" | "min_audio" | "request"
    usd_per_unit: float


# Update these when provider rates change. Unknown (provider, model) pairs get
# logged as $0 — they still show in the entry list so you can backfill prices.
PRICING: dict[tuple[str, str], Price] = {
    # fal — image
    ("fal", "fal-ai/flux-pro/v1.1"): Price("image", 0.05),
    ("fal", "fal-ai/flux-pro/v1.1-ultra"): Price("image", 0.06),
    ("fal", "fal-ai/flux-pro/kontext"): Price("image", 0.04),
    ("fal", "fal-ai/bytedance/seedream/v4/edit"): Price("image", 0.03),
    # fal — image-to-video (Kling v3 pro, audio off)
    ("fal", "fal-ai/kling-video/v3/pro/image-to-video"): Price("sec_video", 0.112),
    # fal — image-to-video (Kling v3 4K native; flat rate regardless of audio)
    ("fal", "fal-ai/kling-video/v3/4k/image-to-video"): Price("sec_video", 0.42),
    # fal — music (per minute of output)
    ("fal", "cassetteai/music-generator"): Price("min_audio", 0.02),
    ("fal", "beatoven/music-generation"): Price("min_audio", 0.02),
    # ElevenLabs SFX — rough estimate; tighten once a billing cycle is observed
    ("elevenlabs", "sound-generation"): Price("request", 0.05),
    # Anthropic — token-priced; rough flat per planning/metadata call
    ("anthropic", "claude-sonnet-4-6"): Price("request", 0.005),
    ("anthropic", "claude-opus-4-7"): Price("request", 0.05),
}


def price_for(provider: str, model: str, units: float) -> tuple[float, str]:
    """Return (cost_usd, unit_name) for a provider call."""
    key = (provider, model)
    if key not in PRICING:
        return 0.0, "unknown"
    p = PRICING[key]
    return units * p.usd_per_unit, p.unit


def record(
    project: "Project",
    *,
    provider: str,
    model: str,
    stage: str,
    artifact_id: str | None = None,
    units: float = 1.0,
) -> CostEntry:
    """Append a cost entry to projects/<slug>/costs.jsonl."""
    cost_usd, unit_name = price_for(provider, model, units)
    entry = CostEntry(
        ts=datetime.utcnow(),
        provider=provider,
        model=model,
        stage=stage,
        artifact_id=artifact_id,
        units=units,
        unit_name=unit_name,
        cost_usd=cost_usd,
    )
    project.costs_path.parent.mkdir(parents=True, exist_ok=True)
    with open(project.costs_path, "a") as f:
        f.write(entry.model_dump_json() + "\n")
    return entry


def load_entries(project: "Project") -> list[CostEntry]:
    if not project.costs_path.exists():
        return []
    entries: list[CostEntry] = []
    with open(project.costs_path) as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(CostEntry.model_validate_json(line))
    return entries


def summarize(project: "Project") -> dict:
    entries = load_entries(project)
    total = sum(e.cost_usd for e in entries)
    by_stage: dict[str, float] = {}
    by_provider: dict[str, float] = {}
    for e in entries:
        by_stage[e.stage] = by_stage.get(e.stage, 0.0) + e.cost_usd
        by_provider[e.provider] = by_provider.get(e.provider, 0.0) + e.cost_usd
    return {
        "total_usd": total,
        "by_stage": by_stage,
        "by_provider": by_provider,
        "entry_count": len(entries),
    }
