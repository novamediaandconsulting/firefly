from datetime import datetime

from rich.console import Console

from .. import costs
from ..project import Project
from ..providers import claude
from ..schemas import StageStatus

console = Console()


def run(project: Project, *, force: bool = False) -> None:
    state = project.load_state()
    stage = state.stage("plan")
    if stage.status == StageStatus.DONE and not force:
        console.print("[dim]plan already done — use --force to regenerate[/dim]")
        return

    console.print(f"[bold]plan[/bold] generating with {state.config.plan_model}…")
    stage.status = StageStatus.IN_PROGRESS
    project.save_state(state)

    try:
        plan = claude.generate_plan(state.concept, state.config.plan_model)
        costs.record(
            project, provider="anthropic", model=state.config.plan_model,
            stage="plan", artifact_id="plan.json",
        )
    except Exception as e:
        stage.status = StageStatus.FAILED
        stage.error = str(e)
        project.save_state(state)
        raise

    project.save_plan(plan)
    stage.status = StageStatus.DONE
    stage.completed_at = datetime.utcnow()
    stage.artifact = "plan.json"
    stage.error = None
    project.save_state(state)
    console.print(f"[green]plan[/green] → {project.plan_path}")
    console.print(f"  working title: {plan.working_title}")
    console.print(f"  clip prompts: {len(plan.clip_prompts)}")
    console.print(f"  sfx layers:   {len(plan.sfx_layers)}")
