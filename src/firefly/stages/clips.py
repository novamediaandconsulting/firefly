from datetime import datetime

from rich.console import Console

from ..project import Project
from ..providers import fal
from ..schemas import ClipItem, ClipManifest, StageStatus

console = Console()


def run(project: Project, *, per_image: int = 4, force: bool = False) -> None:
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
        f"= {per_image * len(approved)} clips with {state.config.video_model}…"
    )
    stage.status = StageStatus.IN_PROGRESS
    project.save_state(state)

    items: list[ClipItem] = list(project.load_clip_manifest().items) if force else []
    existing_ids = {c.id for c in items}

    try:
        prompt_pool = plan.clip_prompts
        clip_counter = len(items)
        for img in approved:
            image_url = fal.upload_image(project.images_dir / img.filename)
            for k in range(per_image):
                clip_counter += 1
                clip_id = f"clip_{clip_counter:03d}"
                if clip_id in existing_ids:
                    continue
                clip_filename = f"{img.id}_{k + 1:02d}.mp4"
                prompt = prompt_pool[(clip_counter - 1) % len(prompt_pool)]
                console.print(f"  {clip_id} ({img.id} #{k + 1})…", end=" ")
                mp4, _meta = fal.generate_clip(
                    image_url, prompt, model=state.config.video_model
                )
                (project.clips_dir / clip_filename).write_bytes(mp4)
                items.append(
                    ClipItem(
                        id=clip_id,
                        image_id=img.id,
                        filename=clip_filename,
                        prompt=prompt,
                        duration_s=5.0,
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
