# Project: Firefly Studio

Local web app that helps a single user produce long-form cozy / ambient
YouTube videos one project at a time. The user steps through:

1. **Title** — names the project; backend derives a unique slug.
2. **Image** — describes a scene, picks a resolution, generates one
   image at a time. Retries until happy. History of every attempt is
   preserved and re-selectable.
3. **Clip** — confirmed image becomes the anchor; user lists motion
   prompts and picks a duration (1–30s, chained 15+15 for >15s). One
   clip generated per Generate. Retry freely.
4. **SFX** — adds N ambient sound layers one at a time. Each layer
   has its own per-attempt history, title, prompt, gain.
5. **Music** — single instrumental track, generate-then-retry-or-skip.
6. **Mix** — per-layer checkbox + dB slider. Real-time Web Audio
   playback while sliding, plus an "exact preview" button that runs
   the same ffmpeg path the final render uses.
7. **Final** — pick a duration in minutes; click Render. Multiple
   variants can be rendered without redoing earlier steps. Complete
   marks the project done.

This file orients future Claude sessions. Most surprises in this codebase
come from external APIs, not from the code itself.

## Architecture

Two processes, one shared filesystem under `projects/`:

```
┌─────────────────────────────┐       HTTP        ┌─────────────────────────┐
│  Next.js 16 App Router      │  ───────────────► │  FastAPI (api/)         │
│  TypeScript + Tailwind 4    │   localhost:8000   │  wraps src/firefly/    │
│  shadcn/ui + Web Audio API  │                    │  studio*.py            │
│  localhost:3000             │   /files static    │  + costs + jobs        │
└─────────────────────────────┘                    └────────────┬────────────┘
                                                                │
                                                                ▼
                                                ┌──────────────────────────────┐
                                                │  projects/<slug>/            │
                                                │  project.json (truth)        │
                                                │  costs.jsonl (append)        │
                                                │  final_*.{png,mp4,wav,mp3}   │
                                                │  attempts/<step>/v<N>.<ext>  │
                                                └──────────────────────────────┘
```

`./dev.sh` runs both servers concurrently with Ctrl-C killing both.

## Data model (`src/firefly/studio.py`)

`StudioProject` is the source of truth, stored as `project.json`:

```python
class StudioProject(BaseModel):
    slug: str                        # immutable after creation
    title: str
    created_at: datetime
    last_modified_at: datetime
    config: StudioConfig             # model IDs
    image: ImageStep                 # prompt, resolution, attempts[], chosen_attempt_id, confirmed
    clip: ClipStep                   # motion_prompts[], duration_s, attempts[], ...
    sfx: SfxStep                     # layers: list[SfxLayer]
    music: MusicStep                 # prompt, skipped, attempts[], chosen_attempt_id
    mix: MixStep                     # layer_gains{}, disabled_layers[], previews[]
    final: FinalStep                 # duration_min, renders[], chosen_render_id, completed_at
    current_job: JobStatus | None    # active background job, drives UI polling
    legacy: bool                     # true if migrated from v1 schema
```

Every step keeps `attempts: list[Attempt]` — nothing is ever overwritten.
Selecting an attempt copies the file to a top-level `final_<step>.<ext>` for
filesystem-obvious "this is what was used."

Slug helpers:
- `derive_slug(title)` — lowercase, hyphenate, strip non-alphanumerics.
- `ensure_unique_slug(title)` — auto-suffixes `-2`, `-3`, … on collision.
- `slug-preview` API endpoint shows the user the final slug live.

## Filesystem layout

```
projects/<slug>/
├── project.json                  # single source of truth (the StudioProject)
├── costs.jsonl                   # append-only cost log
├── final_image.png               # copy of the chosen image attempt
├── final_clip.mp4                # copy of the chosen clip attempt
├── final_music.wav               # copy of the chosen music attempt (absent if skipped)
├── final_sfx_<layer-id>.mp3      # one per active SFX layer
├── final_video_<variant>.mp4     # rendered final variants (may be many)
└── attempts/
    ├── image/v1.png  v1.png.meta.json  v2.png  v2.png.meta.json  …
    ├── clip/v1.mp4   v1.mp4.meta.json  …
    ├── sfx/<layer-id>/v1.mp3  v1.mp3.meta.json  …
    ├── music/v1.wav  v1.wav.meta.json  …
    └── mix_preview/v1.mp3  v1.mp3.meta.json  …
```

Sibling `*.meta.json` files record the prompt, config, timestamp, and cost
that produced each attempt — so navigating the filesystem in Finder tells
the whole story.

Legacy v1 projects (pre-Studio) keep their old files in place and reference
those paths from `project.json` after migration. New attempts go to the new
`attempts/` layout. Mixed layouts in legacy projects are expected.

## Wizard step contract

Each step in `web/app/projects/[slug]/studio/<step>/page.tsx` shares the
same pattern:

1. Fetch project state; subscribe to 2s polling when `current_job` is set.
2. Local form state (prompt, duration, etc.) initialized from the project.
3. On Generate: POST to `/api/projects/<slug>/<step>/generate` → 202 + job.
4. While job runs, header shows the live job badge.
5. Polling sees the new attempt land in `attempts[]`; the UI auto-jumps to it.
6. User can click any prior attempt in the history strip to re-select it
   (and the form repopulates with that attempt's config).
7. Confirm calls `/select/{attempt_id}` then `/confirm/{step}` and routes
   to the next step.

The shared `StudioShell` component (`web/components/studio-shell.tsx`)
renders the step ruler, project title, step + total cost badges, job badge,
and Back/Continue footer.

**Per-step UX details worth knowing:**

- **Clip step** displays the `motion_prompts` list captured in the active
  clip's `config` directly below the video. Without this users have no
  way to verify whether a newly-added prompt was actually factored into
  the generation. Lifted from `attempt.config.motion_prompts`, which the
  job worker fills before saving.
- **Mix step** has both real-time client-side playback (Web Audio) **and**
  a "Render exact preview" button. The mix the final render will use is
  the server-rendered one; the real-time playback is for fast iteration.

## Real-time mix (Web Audio)

`web/app/projects/[slug]/studio/mix/page.tsx`:
- Loads each enabled layer (music + chosen SFX takes) as `AudioBuffer` via
  fetch + `decodeAudioData`.
- Per layer: `AudioBufferSourceNode` with `loop = true` → `GainNode` →
  destination.
- Slider releases call `gain.setTargetAtTime(value, currentTime, 0.02)` for
  click-free transitions; checkbox toggles ramp to 0 / unity.
- "Render exact preview" button calls `/mix/preview` (server ffmpeg mix)
  for a deterministic audible check before final render.
- Local mix state debounce-saves to the server (`PUT /mix`) every 500ms so
  refresh / continue keeps the latest gains.

## Typography

- **Body**: Manrope (300/400/500/600/700) via `next/font/google` → CSS var
  `--font-sans`. Geometric humanist, designer-favorite. Base 16px.
- **Headings + brand wordmark**: Cormorant Garamond (300/400/500/600/700)
  → `--font-serif`. High-contrast classic serif; h1 stays at weight 400
  because it's display-sized; h2-h4 at 500 for screen legibility.
  `font-serif` utility class is wired through `@theme inline` so any
  shadcn component reading `--font-heading` picks it up automatically.
- **Mono**: Geist Mono → `--font-mono`. Pairs cleanly with the serif/sans
  combo without competing for character. Used for badges, costs, model
  names, monospaced metadata.
- Wired in `web/app/layout.tsx`; theme variables in `web/app/globals.css`.

## Provider notes (load-bearing operational details)

### fal.ai — images, video, music

- One key (`FAL_KEY`) covers everything.
- **`fal_client.subscribe` kwarg is `client_timeout`, NOT `timeout`** —
  the obvious-sounding name silently raises `TypeError: unexpected
  keyword argument` at runtime. There's also `start_timeout` (how long
  to wait for the request to even start). Our defaults:
  - music: `client_timeout=180.0`  (CassetteAI/Beatoven typical: <15s)
  - image: `client_timeout=180.0`  (Flux Pro typical: 10-20s)
  - clip:  `client_timeout=480.0`  (Kling typical: 60-90s; chained 30s
    worst-case is 3-4 min)
  Without these, a stuck queue at fal hangs the worker thread forever
  and only the wizard's "cancel" button can rescue it.
- **Kling caps at 15s natively.** Studio's 16–30s clips chain two Kling
  calls: segment 1 runs from the chosen image; ffmpeg extracts segment 1's
  last frame; segment 2 starts from that frame; ffmpeg concats. Motion can
  stutter at the seam; that's a known limitation.
- **Music model is selectable per project** between two fal-hosted
  options:
  - `cassetteai/music-generator` — fast (~15s for 3-min track), bright
  - `beatoven/music-generation` — tuned for ambient
  Allowlist enforced server-side in `studio.py` (`MUSIC_MODELS`). UI
  exposes a radio on the music step that calls `PUT /music/config`.
  **Caveat**: both run on fal's compute backend; when fal's music queue
  stalls (observed 2026-05-19), both models stall together. The radio
  doesn't route around fal — switching is only useful when one specific
  model is failing while fal's queue is otherwise healthy.
- Image model path may drift; if a generation 404s, search fal's model
  directory and patch `StudioConfig.image_model`.
- Always pass `generate_audio: false` to Kling — we layer audio ourselves.

### ElevenLabs — SFX

- Endpoint: `POST /v1/sound-generation`. Cap is **30s** per call.
- `loop: true` for seamless ambient — always use it.
- Restricted API keys only need the **Sound Effects** endpoint enabled.
- Future: ElevenLabs also has a Music Generation endpoint that would
  give us a non-fal music fallback. Not wired yet; would require the
  user to enable "Music Generation" on their restricted API key.

### Claude — not used in Studio

The v1 pipeline used Claude to write a structured Plan with image_prompts
and clip_prompts. Studio drops that — each step's description box is the
user's direct prompt. Claude is referenced in `StudioConfig.plan_model` for
backward-compat but no Studio endpoint calls it.

## Cost tracking

- Every provider call records to `projects/<slug>/costs.jsonl` via
  `costs.record(project_proxy, provider, model, stage, ...)`.
- The stage name normalizes legacy values (`images` → `image`, `clips` →
  `clip`, `audio` → `sfx`, `mux` → `render`) so cost-by-step is uniform.
- `GET /api/projects/<slug>/cost-by-step` returns
  `{by_step: {image: 0.20, clip: 1.12, sfx: 0.15, music: 0.06, render: 0}, total_usd: 1.53}`.
- Wizard shell shows `this step $X · total $Y` in every step's header.

## Background jobs

Generation endpoints (image, clip, sfx, music, mix preview, final render)
return `202 + JobStatus` and submit work to a `ThreadPoolExecutor`. The job
runner (`src/firefly/api/jobs.py`) sets `state.current_job` before running
and clears it on success (or records the error on failure). Frontend polls
project state every 2s while a job is running. On server restart, an
on-startup hook marks any lingering `current_job` as "interrupted".

## CLI (legacy, still works)

`firefly` (typer-based) operates on the v1 schema in
`src/firefly/stages/*`. After the Studio rewrite it's no longer the primary
interface but remains for power-user / scripting use on existing v1
projects. New Studio projects don't have v1 files; CLI commands that read
`state.json` / `plan.json` will fail on them — that's expected. Studio
projects live entirely in `project.json`.

The legacy schemas in `src/firefly/schemas.py` are kept alive for the CLI
and for backward-compat reading by `StudioStore._migrate_from_legacy`.

## Conventions when editing

- **Schema lives in `src/firefly/studio.py`**. Mirror changes in
  `web/lib/types.ts` (no codegen yet).
- **Studio jobs in `src/firefly/studio_jobs.py`**. Each function loads the
  project, generates, writes a new `Attempt` to disk + `.meta.json`,
  appends to `project.json`, records cost.
- **API routes in `src/firefly/api/routes/studio.py`**. One coherent
  `/api/projects/*` surface. Generation routes return 202 with a
  `JobStatus`. Select / confirm are synchronous.
- **Studio frontend pages share the StudioShell**. Don't duplicate header
  scaffolding; pass content as children.
- **Polling is centralized in StudioShell**. Individual pages don't need
  to manage `refetchInterval` for the project query unless they need
  per-step polling above and beyond.
- **Atomic writes**: `StudioStore.save()` uses temp file + `os.replace`.
  Never write `project.json` directly.
- **Backup on overwrite**: not needed in the Studio model — every
  generation produces a new `vN` attempt. The "previous version" is
  always still in `attempts/`.
- **Record every billable call**: any new provider call MUST follow with
  `costs.record(...)`. Add new (provider, model) pairs to
  `costs.PRICING`.

## What's not built

- **YouTube upload / metadata**: no `youtube.json` generator yet.
- **Mobile UI**: desktop-first; doesn't break on iPad but isn't optimized.
- **Auth / multi-user**: single user, local only. No login.
- **Cross-project asset reuse**: each project is isolated; no "use this
  image in a new project" action.
- **Real chained-clip quality**: 16–30s clips work but seam quality varies.
  Future work: train a per-clip transition smoother, or wait for a model
  that does longer natively.

## Environment

- macOS / Apple Silicon. ffmpeg + uv installed via Homebrew.
- Python 3.12; Node 24+ for the web app.
- The user has explicitly asked: **do not read or print the contents of
  `.env`**. Verify keys by running, not by inspecting.

## Recent decisions

- **Studio rewrite (this iteration)**: replaced "generate N variations,
  pick one" with one-at-a-time + retry. Plan-generation step removed.
  Project.json replaces state.json + plan.json + manifests + mix.json +
  final_variants.json. Old v1 wizard frontend deleted; old API routes
  unregistered and their files removed.
- **30s clip cap with 15s chaining**: user wanted up to 30s clips but
  Kling natively caps at 15s. Studio chains two Kling calls for 16-30s.
- **Real-time + exact preview for mix**: Web Audio for instant feedback
  while sliding, ffmpeg for deterministic preview before final render.
- **Auto-migrate legacy projects on first read**: `StudioStore.load()`
  detects a missing `project.json` and builds one from the old files.
  Old files stay on disk; their paths are referenced from the new
  attempts list so legacy assets play back through the new UI.
- **Slug auto-suffix on collision**: avoids rejecting the user with an
  error; the live preview shows the final slug.
- **Cormorant Garamond + Manrope + Geist Mono**: serif/sans pairing for
  an editorial/luxe feel; replaces the v1 Geist baseline. h1 uses serif
  weight 400 because display size carries it; everything else 500.
- **Music model radio (CassetteAI vs Beatoven)**: per-project choice,
  persisted in `project.config.music_model`. Added after observing
  CassetteAI's fal queue stall — though in practice the radio only helps
  when one model is selectively failing; both share fal's compute.
- **fal_client timeouts (`client_timeout`)**: set explicit bounds on
  every fal.subscribe call so a stuck queue raises an error instead of
  hanging the worker thread indefinitely. The kwarg name is non-obvious
  (`client_timeout`, not `timeout`) — getting it wrong fails at runtime
  with `TypeError` instead of being a silent no-op.
- **Clip step shows motion_prompts used**: visibility fix — the
  pipeline already includes every non-empty prompt, but the UI didn't
  surface which prompts produced the active clip, so users couldn't
  confirm a freshly-added prompt landed.
