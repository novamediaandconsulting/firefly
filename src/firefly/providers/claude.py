"""Claude provider — used by stage 1 (plan) and stage 7 (metadata)."""

from __future__ import annotations

from anthropic import Anthropic

from ..config import require_env
from ..schemas import Plan

PLAN_SYSTEM = """You are a creative director for cozy / ambient long-form YouTube videos
(fireplaces in libraries, rain on a patio, lakeside cabins, etc.). Given a user concept,
you produce a structured visual + audio plan.

Guidelines:
- The IMAGE PROMPT must be rich, photoreal, cinematic, single scene, no people unless asked.
  Include lighting, materials, time of day, weather, mood.
- CLIP PROMPTS describe subtle motion variations for image-to-video. Each clip is ~5
  seconds, static camera. Variation should come from motion (flicker intensity, snow drift
  rate, curtain sway, candle wick, etc.) — not camera moves. Generate 10–16 prompts.
- SFX LAYERS are short, loopable ambient layers (fire crackle, light rain, soft wind).
  Pick 2–4 layers. Gain_db is typically -18 to -8.
- MUSIC MOOD is a short phrase for a generative music model: e.g. "slow ambient piano,
  warm reverb, no drums, no vocals".

Call the submit_plan tool exactly once with the structured plan."""


def _client() -> Anthropic:
    require_env(
        "ANTHROPIC_API_KEY",
        "Get a key at https://console.anthropic.com/settings/keys",
    )
    return Anthropic()


def generate_plan(concept: str, model: str) -> Plan:
    schema = Plan.model_json_schema()
    resp = _client().messages.create(
        model=model,
        max_tokens=4096,
        system=PLAN_SYSTEM,
        tools=[
            {
                "name": "submit_plan",
                "description": "Submit the structured video plan.",
                "input_schema": schema,
            }
        ],
        tool_choice={"type": "tool", "name": "submit_plan"},
        messages=[
            {"role": "user", "content": f"Concept: {concept}\n\nProduce a plan."}
        ],
    )
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "submit_plan":
            return Plan.model_validate(block.input)
    raise RuntimeError("Claude did not call submit_plan as expected")
