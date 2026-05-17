from datetime import datetime

from rich.console import Console

from ..project import Project
from ..providers import fal
from ..schemas import ImageItem, ImageManifest, StageStatus

console = Console()


def run(project: Project, *, count: int = 6, force: bool = False) -> None:
    state = project.load_state()
    stage = state.stage("images")
    if stage.status == StageStatus.DONE and not force:
        console.print("[dim]images already generated — use --force to regenerate[/dim]")
        return

    plan = project.load_plan()
    console.print(f"[bold]images[/bold] generating {count} candidates with {state.config.image_model}…")
    stage.status = StageStatus.IN_PROGRESS
    project.save_state(state)

    items: list[ImageItem] = []
    try:
        for i in range(count):
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
