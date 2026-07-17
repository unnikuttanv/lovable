"""Store selector: Postgres when DATABASE_URL is set, JSON-on-disk otherwise.
Both implement the same functions with identical data shapes as the Node backend,
so existing project data and the compose Postgres volume carry over unchanged."""
from .config import DATABASE_URL

if DATABASE_URL:
    from .stores.pg import (  # noqa: F401
        init, list_projects, create_project, get_project, save_project,
        delete_project, get_usage, increment_usage,
    )
    STORE_KIND = "postgres"
else:
    from .stores.disk import (  # noqa: F401
        init, list_projects, create_project, get_project, save_project,
        delete_project, get_usage, increment_usage,
    )
    STORE_KIND = "disk"
