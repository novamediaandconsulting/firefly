# firefly

Automated chill & cozy long-form video generation. Idea in, multi-hour ambient YouTube video out, with QA checkpoints along the way.

## Pipeline

```
concept ─► plan ─► images ─► clips ─► loop ─► audio ─► mux ─► metadata
                    │           │              │
                  QA gate     QA gate       QA gate
```

Each stage writes inspectable artifacts under `projects/<slug>/` and is resumable. Re-running a completed stage is a no-op unless `--force` is passed.

## Setup

```bash
brew install ffmpeg uv          # one-time
uv sync                          # install Python deps into .venv
cp .env.example .env             # fill in keys as you go
```

## Quick start (MVP)

```bash
uv run firefly init demo "cozy library with fireplace, snow outside"
uv run firefly images demo --count 1
uv run firefly clips demo --per-image 1
uv run firefly loop demo --duration-min 10
uv run firefly audio demo
uv run firefly mux demo
open projects/demo/final/demo_*.mp4
```

## Stack

- Python 3.12 + uv
- Claude (Sonnet 4.6 default, Opus 4.7 opt-in) — planning & metadata
- fal.ai — image (Flux 1.1 Pro) & image-to-video (Kling 2)
- ElevenLabs Sound Effects — ambient SFX
- Suno — music beds
- ffmpeg — loop, crossfade, mix, mux
