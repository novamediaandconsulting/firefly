from datetime import datetime

from rich.console import Console

from ..project import Project
from ..providers import fal
from ..schemas import ImageItem, ImageManifest, StageStatus

console = Console()


def regen(project: Project, image_id: str, *, prompt: str | None = None) -> None:
    """Re-generate a single image in place. Backs up the previous version first.

    Approval state is preserved — re-review the file and re-approve / unapprove
    explicitly via `firefly approve images` if you change your mind.
    """
    state = project.load_state()
    manifest = project.load_image_manifest()
    target = next((i for i in manifest.items if i.id == image_id), None)
    if target is None:
        raise RuntimeError(f"image id '{image_id}' not found in manifest")

    target_path = project.images_dir / target.filename
    old_prompt = target.prompt
    new_prompt = prompt or target.prompt

    if target_path.exists():
        ts = int(datetime.utcnow().timestamp())
        backup_img = target_path.with_suffix(f".bak{ts}.png")
        backup_prompt = target_path.with_suffix(f".bak{ts}.prompt.txt")
        target_path.rename(backup_img)
        backup_prompt.write_text(old_prompt)
        console.print(f"  backed up previous version → {backup_img.name}")

    console.print(f"[bold]regen[/bold] {image_id} with {state.config.image_model}…")
    if prompt:
        console.print(f"  new prompt: {new_prompt[:120]}{'…' if len(new_prompt) > 120 else ''}")
    png, meta = fal.generate_image(new_prompt, model=state.config.image_model)
    target_path.write_bytes(png)

    target.prompt = new_prompt
    target.seed = meta.get("seed")
    project.save_image_manifest(manifest)
    console.print(f"[green]regen[/green] → {target_path}")


def run(project: Project, *, count: int = 6, force: bool = False) -> None:
    state = project.load_state()
    stage = state.stage("images")
    if stage.status == StageStatus.DONE and not force:
        console.print("[dim]images already generated — use --force to regenerate[/dim]")
        return

    plan = project.load_plan()

    # Resume from a partial run unless --force; keeps already-paid-for images
    # (and their approval state) and only generates the missing tail.
    items: list[ImageItem] = []
    if not force:
        items.extend(project.load_image_manifest().items)
    start_idx = len(items)
    needed = count - start_idx
    if needed <= 0:
        console.print(f"[dim]already have {start_idx} images; nothing to do[/dim]")
        return
    console.print(
        f"[bold]images[/bold] generating {needed} more candidate(s) "
        f"(have {start_idx}, want {count}) with {state.config.image_model}…"
    )
    stage.status = StageStatus.IN_PROGRESS
    project.save_state(state)

    try:
        for i in range(start_idx, count):
            img_id = f"img_{i + 1:02d}"
            filename = f"{img_id}.png"
            console.print(f"  {img_id}…", end=" ")
            png, meta = fal.generate_image(plan.image_prompt, model=state.config.image_model)
            (project.images_dir / filename).write_bytes(png)
            items.append(
                ImageItem(
                    id=img_id,
                    filename=filename,
                    prompt=plan.image_prompt,
                    seed=meta.get("seed"),
                )
            )
            console.print("[green]ok[/green]")
    except Exception as e:
        stage.status = StageStatus.FAILED
        stage.error = str(e)
        if items:
            project.save_image_manifest(ImageManifest(items=items))
        project.save_state(state)
        raise

    project.save_image_manifest(ImageManifest(items=items))
    stage.status = StageStatus.AWAITING_QA
    stage.completed_at = datetime.utcnow()
    stage.artifact = "images/manifest.json"
    stage.error = None
    project.save_state(state)
    console.print(
        f"[green]images[/green] → {project.images_dir} "
        f"({len(items)} candidates, awaiting approval)"
    )
    console.print(
        f"  approve with: [cyan]firefly approve images {project.slug} <id> [<id>...][/cyan]"
    )
