"""Claude provider — used by stage 1 (plan) and stage 7 (metadata)."""

from __future__ import annotations

from anthropic import Anthropic

from ..config import require_env
from ..schemas import Plan

PLAN_SYSTEM = """You are a creative director for cozy / ambient long-form YouTube videos
(fireplaces in libraries, rain on a patio, lakeside cabins, etc.). Given a user concept,
you produce a structured visual + audio plan.

Guidelines:
- IMAGE PROMPTS: produce 6 varied prompts describing the SAME scene from meaningfully
  different angles or compositions. Each must be rich, photoreal, cinematic, single
  scene, no people unless asked. Vary across the set: camera angle (wide / medium /
  low / eye-level), framing (centered vs offset, more vs less interior), and small
  detail changes (different objects in foreground, different lighting emphasis). Keep
  the core scene, materials, time of day, weather, and mood consistent so the user can
  pick a favorite that all share the same vibe. Each prompt must stand alone and be
  fully descriptive — the image model sees only one prompt at a time.
- CLIP PROMPTS describe subtle motion variations for image-to-video. Each clip is ~10
  seconds, static camera. Variation should come from motion (flicker intensity, snow
  drift rate, curtain sway, candle wick, etc.) — not camera moves. Generate 10–16
  prompts. Never describe things that aren't in the source image.
- SFX LAYERS are short, loopable ambient layers (fire crackle, light rain, soft wind).
  Pick 2–4 layers. Gain_db is typically -18 to -8 for background layers, -6 to 0 for a
  foreground feature (e.g. a brook).
- MUSIC MOOD is a short phrase for a generative music model: e.g. "slow ambient piano,
  warm reverb, no drums, no vocals". If the concept calls for no music (e.g. nature
  scene where ambient SFX is the focus), set music_mood to "None — no background music".

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
