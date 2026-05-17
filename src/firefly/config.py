import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

PROJECTS_ROOT = Path(os.getenv("FIREFLY_PROJECTS_ROOT", "projects"))
ASSETS_ROOT = Path(os.getenv("FIREFLY_ASSETS_ROOT", "assets"))


def require_env(key: str, hint: str) -> str:
    value = os.getenv(key)
    if not value:
        raise RuntimeError(
            f"{key} is not set.\n  {hint}\n  Add it to .env and re-run."
        )
    return value
