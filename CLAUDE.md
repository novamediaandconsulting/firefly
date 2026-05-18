# Project: firefly

Long-form cozy/ambient YouTube video generator. A user types one concept
("cozy library with crackling fireplace, snow outside") and gets back a 1–8 hour
1080p MP4 with original visuals, music, and sound design.

This file orients future Claude sessions. Read in full before editing anything
non-trivial — most surprises in this codebase come from external APIs, not from
the code itself.

## Architecture

A stage-oriented Python CLI. Each stage:

1. reads the project state from `projects/<slug>/state.json`,
2. checks an idempotency gate (skip if `done` unless `--force`),
3. produces an inspectable artifact under `projects/<slug>/`,
4. atomically writes back the updated state.

Stages, in pipeline order:

```
concept → plan → images → clips → loop → audio → mux → metadata
                   │         │              │
                  QA gate   QA gate      preview
```

`QA gate` means the stage finishes in `awaiting_qa` status and the user must
explicitly approve specific artifact IDs (`firefly approve images <slug> <id>...`)
before downstream stages can run.

## Repo layout

```
src/firefly/
├── cli.py               typer entry; main() wraps with friendly error handling
├── config.py            env loading, require_env helper, root paths
├── schemas.py           pydantic models: Plan, State, manifests, StageStatus
├── project.py           Project class — all paths, atomic state I/O
├── ffmpeg.py            ffmpeg/ffprobe wrappers (the only place subprocess lives)
├── providers/
│   ├── claude.py        plan + metadata generation
│   ├── fal.py           Flux images + Kling clips
│   ├── music.py         CassetteAI / Beatoven music beds (via fal)
│   └── elevenlabs.py    Sound Effects layers
└── stages/
    ├── plan.py          concept → plan.json (Claude tool-call structured output)
    ├── images.py        N candidates → images/manifest.json (awaiting_qa)
    ├── clips.py         image-to-video per approved still
    ├── loop.py          build_session → make_loopable → loop_concat
    ├── audio.py         music bed + SFX layers → mixed full-duration audio
    └── mux.py           video + audio → final/<slug>_<min>min.mp4
```

Two roots that aren't gitignored as a class — they have a tracked `.gitkeep`
but their contents are ignored:

- `projects/<slug>/` — generated artifacts. Hundreds of MB per project. Never check in.
- `assets/music/` — optional user-supplied stock music. Used only with `--stock`.

## State model

`State` (in `schemas.py`) holds:

- `slug`, `concept`, `created_at`
- `config: ProjectConfig` — target duration, resolution, model IDs (these are
  baked into the project at `init` so changing the global defaults later does
  not retroactively affect existing projects).
- `stages: dict[str, StageState]` — per-stage status (`pending` → `in_progress`
  → `awaiting_qa` / `done` / `failed`), completion timestamp, primary artifact
  path, last error message.

State is read/written via `_atomic_write_text` in `project.py` — writes go to
`.tmp-*` then `os.replace`. Kill the process mid-stage and the next invocation
sees clean state.

## Provider notes (read these before editing the providers!)

### fal.ai — image, video, music

- One key (`FAL_KEY`) covers everything. Model paths drift; **expect** the
  exact string to be wrong every few months.
- Kling video was at `fal-ai/kling-video/v2/standard/image-to-video` early in
  the project; the current path is `fal-ai/kling-video/v3/pro/image-to-video`.
  When you hit `Path not found`, search fal's model directory for the latest.
- Kling v3 input is `start_image_url`, **not** `image_url`. The older param
  name silently returns nothing helpful.
- Always pass `generate_audio: false` to Kling. Saves $0.05/sec of clip and
  we layer our own audio anyway.
- Music is via CassetteAI (`cassetteai/music-generator`) or Beatoven
  (`beatoven/music-generation`). Both take `prompt` + `duration` and return
  `audio_file.url`. Up to ~180s per generation; we loop to target with ffmpeg.

### Claude — plan + metadata

- Uses tool-calling for structured output: the model is forced to call a tool
  whose `input_schema` is the pydantic JSON schema of the target type (`Plan`,
  etc.). Cleanest way to get guaranteed-valid JSON.
- Default model is **Sonnet 4.6** (cheap, plenty for this). Opus 4.7 is
  available via `--plan-model claude-opus-4-7` at project init.
- The system prompt in `providers/claude.py` constrains the plan style: no
  people, static camera, motion-only variation, 10–16 clip prompts, 2–4
  SFX layers. Edit the prompt to change creative direction.

### ElevenLabs — SFX layers

- Endpoint: `/v1/sound-generation` (still works). Header: `xi-api-key`.
- Max `duration_seconds` is **30**, not 22.
- Critical flag: `loop: true` — produces seamlessly-loopable audio. Use it
  for every SFX layer, since we loop them for hours.
- Default model: `eleven_text_to_sound_v2`.
- Restricted API keys only need the **Sound Effects** endpoint enabled. Music
  Generation is on ElevenLabs too but we use fal instead.

### Why not Suno

There is no official public Suno API as of 2026 — all "Suno API" providers
(sunoapi.org, EvoLink, Apiframe, PiAPI) are third-party wrappers around
Suno's internal endpoints. They can break overnight and are ToS-grey. Music
goes through fal's first-party music models instead.

If you ever wire Suno: add a new `providers/suno.py`, configure via a
`SUNO_API_KEY` env var, and toggle via the `music_model` field in
`ProjectConfig` (e.g. `music_model: "suno/v5"`). Keep the fal path as the
default.

## ffmpeg pipeline (the trickiest part)

The loop stage threads three operations:

1. **`build_session(clips, dst, resolution, fps, xfade_s)`** — concatenates
   N clips with crossfades. Every input is pre-normalized (`scale`, `crop`,
   `fps`, `setpts`, `format=yuv420p`) so xfade has uniform inputs. With
   N == 1, it's just a normalize-and-re-encode. Output is `session.mp4`,
   duration = `sum(clip_durations) - (N-1) * xfade_s`.
2. **`make_loopable(src, dst, xfade_s)`** — crossfades the tail of `src` over
   its head. Result is the same duration as `src`, but when looped, the loop
   boundary is hidden. This is what makes a 5-second clip (or an 80-second
   multi-clip session) play smoothly for hours.
3. **`loop_concat(loopable, dst, target_s)`** — uses `-stream_loop -1 -i ... -t
   target -c:v copy`. No re-encode, instant even for 8-hour outputs.

Why `-c:v copy` works: build_session + make_loopable already produced H.264
yuv420p at the target resolution & fps. The loop step just rewrites packet
timestamps; the bytes are unchanged.

Audio mixing (`ffmpeg.mix_audio`) uses `amix` with per-layer `volume=<dB>dB`
and `-stream_loop -1` on each input. All layers loop independently to the
target duration, which is fine — they're ambient.

## CLI

```bash
# Pipeline (run in order)
uv run firefly init <slug> "<concept>"               # creates project, no API calls
uv run firefly plan <slug> [--force]
uv run firefly images <slug> [-n 4] [--force]        # awaiting_qa after success
uv run firefly approve images <slug> img_01 img_03 ...
uv run firefly clips <slug> [-n 3]                   # n clips per approved image, 10s each
uv run firefly approve clips <slug> img_01_01 img_03_02 ...
uv run firefly loop <slug> [--duration-min 480]
uv run firefly audio <slug> [--silent|--stock|--no-music|--skip-sfx]
                            [--sfx-variations 3] [--music-variations 3]
uv run firefly mux <slug>
uv run firefly status <slug>
uv run firefly cost <slug>                           # breakdown of spend from costs.jsonl

# QA iteration (re-roll individual artifacts; backs up the previous version)
uv run firefly regen image <slug> <img_id> [--prompt "..."]
uv run firefly regen clip  <slug> <clip_id> [--prompt "..."]
uv run firefly regen sfx   <slug> "<layer name>" [--prompt "..."] [-n 3]

# Pick the winning variation (cp + audio --force is automated under the hood)
uv run firefly pick sfx   <slug> "<layer name>" v2
uv run firefly pick music <slug> v2

# Mix board (per-layer gain overrides used by `render`)
uv run firefly mix preview <slug> -l "_music=-12" -l "Babbling Brook=0" [-d 60]
uv run firefly mix lock    <slug> -l "_music=-12" -l "Babbling Brook=0"
uv run firefly mix show    <slug>

# Named final variants (no API calls — reuses source files)
uv run firefly render   <slug> 30min       -d 30   [--audio-mode default]
uv run firefly render   <slug> 8hr_silent  -d 480  --audio-mode silent
uv run firefly variants <slug>             # list registered variants
```

The `init` command takes optional `--duration-min`, `--resolution`,
`--plan-model`. These are baked into `state.json` at creation time.

Audio flags:
- `--silent` — no music, no SFX, just a silent track (debug / video-only test).
- `--stock` — use any file in `assets/music/` instead of generating music.
- `--no-music` — SFX only (e.g. a brook video where you only want nature sound).
- `--skip-sfx` — music only.

### Idempotency rules

- A stage with status `done` is a no-op on re-run, except with `--force`.
- `--force` re-runs the stage logic, which is generally a remix, not a
  re-generation. Specifically: **the music bed is sticky** — once
  `intermediate/music_bed.wav` is written it is reused. To regenerate the
  music, delete that file. Same for SFX layers (`intermediate/sfx_*.mp3`).
  This guard prevents accidental re-spend.
- `images` and `clips` always append to their manifest. If you want a clean
  slate, delete the directory before re-running.
- `regen` commands always back up the previous artifact next to the original
  as `<stem>.bak<unix-ts>.<ext>` (with a sibling `.prompt.txt` recording the
  prompt that produced it). Restore by `mv`-ing the .bak back over the
  original filename. **Never overwrite without backup** — see the recent
  decisions section for why.
- `regen sfx` writes variations as `intermediate/sfx_<slug>_v1.mp3`,
  `_v2.mp3`, etc., leaving the canonical `sfx_<slug>.mp3` alone. After
  picking a winner, `cp` the chosen variation over the canonical and run
  `audio --force && mux --force` to remix.

## Cost expectations (per 8-hour video)

| Stage | Default count | Per-unit | Subtotal |
|---|---|---|---|
| plan (Claude Sonnet) | 1 | ~$0.001 | <$0.01 |
| images (Flux Pro 1.1) | 6 candidates | ~$0.05 | $0.30 |
| clips (Kling v3 pro, audio off) | 20 keepers × 5s | ~$0.56 | $11.20 |
| music (CassetteAI) | 1 × 180s | ~$0.20 | $0.20 |
| sfx (ElevenLabs) | 3 × 30s | ~$0.05 | $0.15 |
| metadata | 1 | <$0.01 | <$0.01 |
| **total** | | | **~$12** |

The Kling line is the dominant cost. Switching Kling models or reducing the
clip deck is the lever for cost. ffmpeg renders are free but consume CPU/SSD.

## Common operations

- **Smoke test (cheapest)**: `firefly init demo "..."`, then `plan`, then
  `images -n 1`, approve, `clips -n 1`, approve, `loop --duration-min 10`,
  `audio --silent`, `mux`. Total spend < $1.
- **Switch the planning model temporarily**: edit `state.json` field
  `config.plan_model` directly (it's a plain JSON file), then re-run `plan
  --force`.
- **Patch a stale fal model path**: edit `config.image_model` /
  `config.video_model` / `config.music_model` in `state.json`. New defaults
  in `schemas.py` apply only to projects created after.
- **Regenerate music with a different mood**: edit
  `projects/<slug>/plan.json` `music_mood`, then delete
  `intermediate/music_bed.wav`, then `audio --force`.

## Web app (in progress)

We are building a local web app (Next.js + FastAPI) around the CLI pipeline.
The CLI stays first-class — every web action is a thin wrapper over the same
stage functions. Phased build:

- **Phase 1: Pipeline refactor** ✅ DONE
  - `Plan.image_prompts: list[str]` so each candidate image is meaningfully
    different (different camera angle / composition / lighting); legacy
    `image_prompt: str` plans coerce automatically.
  - Defaults: 3 clips per image, 10s each; 3 SFX variations per layer; 3
    music variations. All overrideable via flags.
  - `MixConfig` (mix.json) for per-layer gain overrides; `firefly mix
    preview/lock/show`.
  - `FinalVariant` (final_variants.json) tracks named renders; `firefly
    render <slug> <variant> -d <min>` produces additional final MP4s without
    redoing the costly stages.
  - `costs.jsonl` append-only log + `firefly cost`; pricing table in
    `src/firefly/costs.py`.
- **Phase 2: FastAPI service** — REST + SSE around every stage. CORS-open
  for localhost:3000. Static file serving for media.
- **Phase 3: Next.js scaffold** — project list + detail (read-only).
- **Phases 4–7: 9-step wizard** — concept → plan → refine → images →
  clips → SFX → music → mix board → final variants. Cost tracker in header.

## What's still not built

- **Metadata stage** (Claude → `youtube.json` with title, description, tags,
  AI-disclosure boilerplate). Scaffolding is there but the stage module isn't
  wired up.
- **Multi-deck randomization** — currently the loop stage builds one session
  ordering. For 8-hour videos with many clips, shuffling the order each cycle
  would further reduce perceived repetition. Plumb as a v3 feature only if
  the single-deck output feels repetitive at scale.
- **Topaz / fal upscaler integration** — for 4K outputs viewers play on big
  TVs. Currently 1080p only by default. The `resolution` config field
  accepts `4k` and downstream ffmpeg honors it; we just don't have an AI
  upscaling step.

## Conventions to follow when editing

- **Provider modules raise plain RuntimeError**, never custom exception
  classes. The CLI's top-level `main()` catches everything and prints a
  one-line message — keep the messages short and actionable.
- **Stages are functions named `run(project, *, ...) -> None`**, not classes.
  They mutate state via `project.save_state(...)` and write files; they
  return nothing.
- **All paths go through `Project` properties** (`project.images_dir`,
  `project.video_track_path`, etc.). Do not construct paths from string
  concatenation elsewhere — it makes moving the project layout painful.
- **Atomic state writes**: always `project.save_state(state)`, never write
  `state.json` directly. The `_atomic_write_text` helper handles temp file
  + rename.
- **Friendly errors**: a missing API key should raise via `require_env(...)`
  with a URL the user can visit. A bad model path should surface the
  provider's own error message. Don't wrap everything in try/except —
  the top-level handler does that.
- **Cost guards**: any new generative stage MUST default to a small count
  (1–6) and require an explicit flag/argument to scale up. Never default to
  generating 20 of something.
- **One canonical name per artifact**: the artifact ID the user types on the
  CLI must equal the filename stem on disk. Clip IDs are `img_01_01` (not
  `clip_001`) so the file `clips/img_01_01.mp4` is unambiguous. When adding a
  new artifact type, follow this rule.
- **Always back up before overwrite**: any operation that regenerates a
  user-reviewed artifact (image, clip, SFX) must rename the previous version
  to `<stem>.bak<ts>.<ext>` first. Losing user-approved work because of a
  blind overwrite is the worst kind of UX failure here.
- **Record every billable call**: a stage that calls a paid API MUST follow
  the call with `costs.record(project, provider=..., model=..., stage=...,
  artifact_id=..., units=...)`. Otherwise the cost dashboard lies. Add new
  (provider, model) pairs to `costs.PRICING` when introducing them.
- **Variation pattern**: any user-choosable asset (SFX layer, music bed, and
  the upcoming clip variants) follows the same canonical-vs-variation pattern:
  generate `<base>_v1.<ext>`, `_v2.<ext>`, … in `intermediate/`, copy v1 over
  the canonical `<base>.<ext>` as a default. Add a `firefly pick <kind>
  <slug> [name] vN` command to swap, then `audio --force && mux --force`
  (or `render`) to remix.

## Environment quirks

- macOS / Apple Silicon. ffmpeg installed via Homebrew.
- Python 3.12 required (managed by `uv`).
- The user has explicitly asked: **do not read or print the contents of
  `.env`**. Trust the SDK to pick up keys via env vars; verify success from
  command behavior, not file inspection. See
  `~/.claude/projects/.../memory/feedback_env_secrets.md`.

## Recent decisions

- Switched music generation from Suno → fal (CassetteAI). Reason: no official
  Suno API; third-party wrappers are unstable.
- Switched Kling from v2 → v3 pro. Reason: v2 path was 404'd by fal.
- Audio sub-artifacts (`music_bed.wav`, `sfx_*.mp3`) are sticky across
  `--force` runs. Reason: avoid surprise re-spend; remix is the cheap part.
- `loop_concat` uses `-c:v copy`. Reason: 8-hour H.264 re-encode is a 5–10
  minute job; copy is instantaneous and the upstream stages already produced
  the correct format.
- Clip IDs were unified with their filenames (`img_01_01` instead of
  `clip_001`). Reason: user had to juggle two parallel naming schemes — the
  CLI ID vs. the filename — and got annoyed translating between them. ID ==
  filename stem now.
- All `regen` commands back up the prior artifact before overwriting.
  Reason: a blind overwrite in an early regen wiped a clip the user wanted to
  keep. Lost user work is the cardinal sin here, so backup-on-write is now
  enforced in code, not convention.
- Default Kling negative prompt now suppresses random sparkles, dust motes,
  ambient light pulses across the room, ember showers, and "snowflakes
  indoors." Reason: Kling's defaults love these artifacts and they look
  unnatural in long ambient shots. Add new project-specific suppressions to
  the negative prompt before regenerating clips.
- `--no-music` flag added to the audio stage. Reason: some videos (nature
  scenes with strong primary SFX, e.g. brook foreground) read as more
  authentic with no music bed at all. The plan generator sets `music_mood:
  "None — no background music"` for these but the CLI still needs the flag
  to honor it.
- Image candidates use 6 varied prompts from Claude (cycled if user wants
  more) instead of N renders of the same prompt. Reason: earlier batches
  looked nearly identical because fal randomness alone barely changes the
  composition — Claude varying camera angle / framing / lighting in the
  prompt itself gives meaningfully different candidates.
- Default clip duration bumped 5s → 10s; default per-image count 4 → 3.
  Reason: a single 10-sec session, once made loopable, gives more visual
  variety per loop than four 5-sec clips back-to-back; and the user is
  picking just one anyway, so generating fewer candidates saves money.
- SFX & music variations are produced by default (3 each), not lazily via
  a separate `regen` command. Reason: the user almost always wants A/B/C
  comparison; making it the default avoids a second round trip. `pick sfx`
  / `pick music` promote the winner; `regen sfx` is still there for when
  the prompt itself needs revision.
- Render is split from mux. Reason: `mux` produces the primary
  `<slug>_<duration>min.mp4` from the canonical video+audio tracks. `render`
  produces named variants (`<slug>_<variant>.mp4`) at arbitrary durations
  with arbitrary mix overrides — no API calls, just ffmpeg.
