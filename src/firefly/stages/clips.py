from datetime import datetime

from rich.console import Console

from .. import costs
from ..project import Project
from ..providers import fal
from ..schemas import ClipItem, ClipManifest, StageStatus

console = Console()


def regen(project: Project, clip_id: str, *, prompt: str | None = None) -> None:
    """Re-generate a single clip in place. Backs up the previous version first.

    If `prompt` is None, reuses the existing prompt (re-rolls with a fresh seed).
    Resets approved=False so the user reviews again.

    Backups land at `<filename>.bak<unix-ts>.mp4` next to the original, with a
    sibling `.bak<unix-ts>.prompt.txt` recording the prompt. Restore manually
    by moving the .bak file back over the original filename.
    """
    state = project.load_state()
    manifest = project.load_clip_manifest()
    target = next((c for c in manifest.items if c.id == clip_id), None)
    if target is None:
        raise RuntimeError(f"clip id '{clip_id}' not found in manifest")

    image_manifest = project.load_image_manifest()
    image = next((i for i in image_manifest.items if i.id == target.image_id), None)
    if image is None:
        raise RuntimeError(f"source image '{target.image_id}' not found")

    target_path = project.clips_dir / target.filename
    old_prompt = target.prompt
    new_prompt = prompt or target.prompt

    if target_path.exists():
        ts = int(datetime.utcnow().timestamp())
        backup_video = target_path.with_suffix(f".bak{ts}.mp4")
        backup_prompt = target_path.with_suffix(f".bak{ts}.prompt.txt")
        target_path.rename(backup_video)
        backup_prompt.write_text(old_prompt)
        console.print(f"  backed up previous version → {backup_video.name}")

    console.print(
        f"[bold]regen[/bold] {clip_id} (source {target.image_id}) "
        f"with {state.config.video_model}…"
    )
    if prompt:
        console.print(f"  new prompt: {new_prompt[:120]}{'…' if len(new_prompt) > 120 else ''}")
    image_url = fal.upload_image(project.images_dir / image.filename)
    mp4, _meta = fal.generate_clip(image_url, new_prompt, model=state.config.video_model)
    target_path.write_bytes(mp4)
    costs.record(
        project, provider="fal", model=state.config.video_model,
        stage="clips", artifact_id=clip_id, units=target.duration_s,
    )

    target.prompt = new_prompt
    target.approved = False
    project.save_clip_manifest(manifest)
    console.print(f"[green]regen[/green] → {target_path}")
    console.print(f"  re-review then: [cyan]firefly approve clips {project.slug} {clip_id}[/cyan]")


def run(project: Project, *, per_image: int = 3, force: bool = False) -> None:
    state = project.load_state()
    stage = state.stage("clips")
    if stage.status == StageStatus.DONE and not force:
        console.print("[dim]clips already generated — use --force to regenerate[/dim]")
        return

    plan = project.load_plan()
    image_manifest = project.load_image_manifest()
    approved = [i for i in image_manifest.items if i.approved]
    if not approved:
        raise RuntimeError(
            "No approved images. Run `firefly approve images <slug> <id>...` first."
        )

    console.print(
        f"[bold]clips[/bold] generating {per_image} per image × {len(approved)} images "
        f"= {per_image * len(approved)} × {state.config.clip_duration_s}s clips with "
        f"{state.config.video_model}…"
    )
    stage.status = StageStatus.IN_PROGRESS
    project.save_state(state)

    items: list[ClipItem] = list(project.load_clip_manifest().items) if force else []
    existing_ids = {c.id for c in items}

    try:
        prompt_pool = plan.clip_prompts
        prompt_index = 0
        for img in approved:
            image_url = fal.upload_image(project.images_dir / img.filename)
            for k in range(per_image):
                # id and filename align: img_01_01 → img_01_01.mp4
                clip_id = f"{img.id}_{k + 1:02d}"
                clip_filename = f"{clip_id}.mp4"
                if clip_id in existing_ids:
                    prompt_index += 1
                    continue
                prompt = prompt_pool[prompt_index % len(prompt_pool)]
                prompt_index += 1
                console.print(f"  {clip_id}…", end=" ")
                duration_s = float(state.config.clip_duration_s)
                mp4, _meta = fal.generate_clip(
                    image_url, prompt,
                    model=state.config.video_model,
                    duration=str(state.config.clip_duration_s),
                )
                (project.clips_dir / clip_filename).write_bytes(mp4)
                costs.record(
                    project, provider="fal", model=state.config.video_model,
                    stage="clips", artifact_id=clip_id, units=duration_s,
                )
                items.append(
                    ClipItem(
                        id=clip_id,
                        image_id=img.id,
                        filename=clip_filename,
                        prompt=prompt,
                        duration_s=duration_s,
                    )
                )
                console.print("[green]ok[/green]")
                project.save_clip_manifest(ClipManifest(items=items))
    except Exception as e:
        stage.status = StageStatus.FAILED
        stage.error = str(e)
        project.save_state(state)
        raise

    stage.status = StageStatus.AWAITING_QA
    stage.completed_at = datetime.utcnow()
    stage.artifact = "clips/manifest.json"
    stage.error = None
    project.save_state(state)
    console.print(
        f"[green]clips[/green] → {project.clips_dir} "
        f"({len(items)} clips, awaiting approval)"
    )
    console.print(
        f"  approve with: [cyan]firefly approve clips {project.slug} <id> [<id>...][/cyan]"
    )
