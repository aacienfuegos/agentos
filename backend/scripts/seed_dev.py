"""
Dev seed script — puebla la BD con datos realistas para poder probar la UI.
Idempotente: no inserta nada si ya hay runs en la BD.

Uso:
    cd backend && uv run python scripts/seed_dev.py
"""
import sys
import os
import uuid
from datetime import datetime, timedelta

_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_root_dir = os.path.dirname(_backend_dir)
sys.path.insert(0, _backend_dir)

# Carga .env desde la raíz del proyecto (o backend/) antes de que pydantic-settings lo intente
for _env_path in [os.path.join(_root_dir, ".env"), os.path.join(_backend_dir, ".env")]:
    if os.path.exists(_env_path):
        with open(_env_path) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _, _v = _line.partition("=")
                    os.environ.setdefault(_k.strip(), _v.strip())
        break

# Valores mínimos para que pydantic-settings no falle en modo seed
os.environ.setdefault("SECRET_KEY", "dev-seed-dummy-key")
os.environ.setdefault("ADMIN_PASSWORD", "dev-seed-dummy")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-dev-seed-dummy")
# Fuera de Docker: usa una BD local en backend/. Dentro de Docker: ya viene DATABASE_URL del env.
_default_db = os.path.join(_backend_dir, "agentos_dev.db")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_default_db}")

from sqlmodel import Session, select
from agentos.database import engine, create_db_and_tables
from agentos.agents.builtin import seed_builtin_agents
from agentos.models import Run, RunStatus, Schedule, LogEntry


def _id() -> str:
    return str(uuid.uuid4())


def _ago(**kwargs) -> datetime:
    return datetime.utcnow() - timedelta(**kwargs)


def _seed_schedules(session: Session) -> dict[str, str]:
    schedules = [
        Schedule(
            id=_id(),
            agent_id="code-review",
            name="Daily PR Review",
            cron_expression="0 9 * * 1-5",
            input_params={},
            enabled=True,
            last_run_at=_ago(days=1),
            next_run_at=datetime.utcnow() + timedelta(hours=16),
            created_at=_ago(days=30),
        ),
        Schedule(
            id=_id(),
            agent_id="portfolio-updater",
            name="Weekly Portfolio Sync",
            cron_expression="0 8 * * 1",
            input_params={},
            enabled=True,
            last_run_at=_ago(days=5),
            next_run_at=datetime.utcnow() + timedelta(days=2),
            created_at=_ago(days=60),
        ),
        Schedule(
            id=_id(),
            agent_id="vuln-scan",
            name="Sunday Vuln Scan",
            cron_expression="0 2 * * 0",
            input_params={},
            enabled=False,
            last_run_at=_ago(days=7),
            next_run_at=None,
            created_at=_ago(days=45),
        ),
    ]
    for s in schedules:
        session.add(s)
    session.flush()
    return {s.agent_id: s.id for s in schedules}


def _logs_success(run_id: str, agent_id: str) -> list[LogEntry]:
    base = _ago(minutes=5)

    if agent_id == "code-review":
        entries = [
            ("info", "Iniciando análisis de PR #47", None),
            ("tool_use", "get_pull_request", {"name": "get_pull_request", "input": {"repo": "agentos", "pr_number": 47}}),
            ("tool_result", "PR recuperado: feat/jwt-auth-middleware", {"tool": "get_pull_request", "output": "PR #47: 12 ficheros, +340 -28"}),
            ("tool_use", "list_pr_files", {"name": "list_pr_files", "input": {"repo": "agentos", "pr_number": 47}}),
            ("tool_result", "12 ficheros modificados", {"tool": "list_pr_files", "output": ["backend/agentos/middleware.py", "frontend/src/app/login/page.tsx"]}),
            ("info", "Generando review con Claude...", None),
            ("tool_use", "post_review_comment", {"name": "post_review_comment", "input": {"body": "LGTM con sugerencias menores"}}),
            ("tool_result", "Comentario publicado en PR #47", {"tool": "post_review_comment", "output": "comment_id: 1234567"}),
            ("done", "Review completado para PR #47", {"tokens_input": 3240, "tokens_output": 892}),
        ]
    elif agent_id == "portfolio-updater":
        entries = [
            ("info", "Obteniendo repos públicos de GitHub", None),
            ("tool_use", "github_list_repos", {"name": "github_list_repos", "input": {"username": "aacienfuegos"}}),
            ("tool_result", "23 repos encontrados", {"tool": "github_list_repos", "output": 23}),
            ("info", "Filtrando repos con actividad reciente...", None),
            ("tool_use", "update_portfolio_json", {"name": "update_portfolio_json", "input": {"repos": 8}}),
            ("tool_result", "portfolio.json actualizado con 8 proyectos", {"tool": "update_portfolio_json"}),
            ("done", "Portfolio actualizado correctamente", {"tokens_input": 1820, "tokens_output": 440}),
        ]
    elif agent_id == "vuln-scan":
        entries = [
            ("info", "Iniciando escaneo de vulnerabilidades", None),
            ("tool_use", "run_semgrep", {"name": "run_semgrep", "input": {"path": "/app"}}),
            ("tool_result", "Semgrep completado: 0 issues críticos", {"tool": "run_semgrep", "output": {"critical": 0, "high": 1, "medium": 3}}),
            ("tool_use", "run_gitleaks", {"name": "run_gitleaks", "input": {"path": "/app"}}),
            ("tool_result", "Gitleaks: no se encontraron secrets", {"tool": "run_gitleaks", "output": {"leaks": 0}}),
            ("done", "Escaneo completado sin issues críticos", {"tokens_input": 2100, "tokens_output": 310}),
        ]
    else:
        entries = [
            ("info", "Iniciando tarea custom", None),
            ("tool_use", "bash", {"name": "bash", "input": {"command": "echo hello"}}),
            ("tool_result", "hello", {"tool": "bash", "output": "hello\n"}),
            ("done", "Tarea completada", {"tokens_input": 890, "tokens_output": 210}),
        ]

    logs = []
    for i, (level, message, extra) in enumerate(entries):
        logs.append(LogEntry(
            run_id=run_id,
            level=level,
            message=message,
            extra=extra,
            created_at=base + timedelta(seconds=i * 8),
        ))
    return logs


def _logs_failed(run_id: str, agent_id: str) -> list[LogEntry]:
    base = _ago(days=2, minutes=3)

    if agent_id == "code-review":
        entries = [
            ("info", "Iniciando análisis de PR #45", None),
            ("tool_use", "get_pull_request", {"name": "get_pull_request", "input": {"repo": "agentos", "pr_number": 45}}),
            ("error", "GitHub API error: 403 Forbidden — token sin permisos pull_request:read", {"status_code": 403}),
        ]
    else:
        entries = [
            ("info", "Iniciando escaneo", None),
            ("tool_use", "run_semgrep", {"name": "run_semgrep", "input": {"path": "/app"}}),
            ("error", "Docker socket no disponible: permission denied", {"errno": 13}),
        ]

    logs = []
    for i, (level, message, extra) in enumerate(entries):
        logs.append(LogEntry(
            run_id=run_id,
            level=level,
            message=message,
            extra=extra,
            created_at=base + timedelta(seconds=i * 6),
        ))
    return logs


def _logs_running(run_id: str) -> list[LogEntry]:
    base = _ago(minutes=8)
    entries = [
        ("info", "Iniciando análisis de PR #49", None),
        ("tool_use", "get_pull_request", {"name": "get_pull_request", "input": {"repo": "agentos", "pr_number": 49}}),
        ("tool_result", "PR recuperado: feat/knowledge-agent", {"tool": "get_pull_request", "output": "PR #49: 7 ficheros, +210 -5"}),
        ("info", "Analizando cambios con Claude...", None),
    ]
    logs = []
    for i, (level, message, extra) in enumerate(entries):
        logs.append(LogEntry(
            run_id=run_id,
            level=level,
            message=message,
            extra=extra,
            created_at=base + timedelta(seconds=i * 10),
        ))
    return logs


def _seed_runs(session: Session, schedule_ids: dict[str, str]) -> None:
    cr_schedule_id = schedule_ids.get("code-review")
    pu_schedule_id = schedule_ids.get("portfolio-updater")

    runs_and_logs: list[tuple[Run, list[LogEntry]]] = []

    # --- code-review ---
    r1_id = _id()
    r1 = Run(
        id=r1_id,
        agent_id="code-review",
        triggered_by="manual",
        status=RunStatus.success,
        input_params={"pr_number": 47, "repo": "agentos"},
        output="PR #47 revisado. Se encontraron 2 sugerencias de mejora en el manejo de errores del middleware JWT. LGTM con cambios menores.",
        tokens_input=3240,
        tokens_output=892,
        cost_usd=0.0142,
        started_at=_ago(days=3, minutes=2),
        finished_at=_ago(days=3),
        created_at=_ago(days=3, minutes=3),
    )
    runs_and_logs.append((r1, _logs_success(r1_id, "code-review")))

    r2_id = _id()
    r2 = Run(
        id=r2_id,
        agent_id="code-review",
        triggered_by="manual",
        status=RunStatus.failed,
        input_params={"pr_number": 45, "repo": "agentos"},
        error="GitHub API error: 403 Forbidden — token sin permisos pull_request:read",
        started_at=_ago(days=2, minutes=3),
        finished_at=_ago(days=2, minutes=2, seconds=48),
        created_at=_ago(days=2, minutes=4),
    )
    runs_and_logs.append((r2, _logs_failed(r2_id, "code-review")))

    r3_id = _id()
    r3 = Run(
        id=r3_id,
        agent_id="code-review",
        schedule_id=cr_schedule_id,
        triggered_by="schedule",
        status=RunStatus.running,
        input_params={"pr_number": 49, "repo": "agentos"},
        started_at=_ago(minutes=8),
        created_at=_ago(minutes=9),
    )
    runs_and_logs.append((r3, _logs_running(r3_id)))

    r4_id = _id()
    r4 = Run(
        id=r4_id,
        agent_id="code-review",
        triggered_by="manual",
        status=RunStatus.pending,
        input_params={"pr_number": 50, "repo": "agentos"},
        created_at=_ago(minutes=2),
    )
    runs_and_logs.append((r4, []))

    # --- portfolio-updater ---
    r5_id = _id()
    r5 = Run(
        id=r5_id,
        agent_id="portfolio-updater",
        schedule_id=pu_schedule_id,
        triggered_by="schedule",
        status=RunStatus.success,
        input_params={},
        output="Portfolio actualizado con 8 proyectos. Nuevos repos añadidos: agentos, ml-experiments.",
        tokens_input=1820,
        tokens_output=440,
        cost_usd=0.0058,
        started_at=_ago(days=5, minutes=1),
        finished_at=_ago(days=5),
        created_at=_ago(days=5, minutes=2),
    )
    runs_and_logs.append((r5, _logs_success(r5_id, "portfolio-updater")))

    r6_id = _id()
    r6 = Run(
        id=r6_id,
        agent_id="portfolio-updater",
        triggered_by="manual",
        status=RunStatus.success,
        input_params={},
        output="Portfolio sincronizado. Sin cambios detectados respecto al último sync.",
        tokens_input=1540,
        tokens_output=280,
        cost_usd=0.0041,
        started_at=_ago(days=1, minutes=1),
        finished_at=_ago(days=1),
        created_at=_ago(days=1, minutes=2),
    )
    runs_and_logs.append((r6, _logs_success(r6_id, "portfolio-updater")))

    r7_id = _id()
    r7 = Run(
        id=r7_id,
        agent_id="portfolio-updater",
        triggered_by="manual",
        status=RunStatus.cancelled,
        input_params={},
        started_at=_ago(days=1, hours=3, minutes=1),
        finished_at=_ago(days=1, hours=3),
        created_at=_ago(days=1, hours=3, minutes=2),
    )
    runs_and_logs.append((r7, []))

    # --- vuln-scan ---
    r8_id = _id()
    r8 = Run(
        id=r8_id,
        agent_id="vuln-scan",
        triggered_by="manual",
        status=RunStatus.success,
        input_params={"path": "/app"},
        output="Escaneo completado. Semgrep: 0 críticos, 1 high, 3 medium. Gitleaks: 0 secrets. Revisar findings de severidad high en backend/agentos/api/webhooks.py.",
        tokens_input=2100,
        tokens_output=310,
        cost_usd=0.0039,
        started_at=_ago(days=7, minutes=5),
        finished_at=_ago(days=7),
        created_at=_ago(days=7, minutes=6),
    )
    runs_and_logs.append((r8, _logs_success(r8_id, "vuln-scan")))

    r9_id = _id()
    r9 = Run(
        id=r9_id,
        agent_id="vuln-scan",
        triggered_by="manual",
        status=RunStatus.failed,
        input_params={"path": "/app"},
        error="Docker socket no disponible: permission denied /var/run/docker.sock",
        started_at=_ago(days=3, minutes=1),
        finished_at=_ago(days=3, seconds=40),
        created_at=_ago(days=3, minutes=2),
    )
    runs_and_logs.append((r9, _logs_failed(r9_id, "vuln-scan")))

    # --- custom ---
    r10_id = _id()
    r10 = Run(
        id=r10_id,
        agent_id="custom",
        triggered_by="api",
        status=RunStatus.success,
        input_params={"task": "Generar resumen semanal de actividad del repo agentos"},
        output="Resumen semanal: 3 PRs mergeadas, 12 commits, 2 issues cerrados. Actividad principal en backend (auth middleware) y frontend (dashboard).",
        tokens_input=890,
        tokens_output=210,
        cost_usd=0.0018,
        started_at=_ago(days=2, minutes=1),
        finished_at=_ago(days=2),
        created_at=_ago(days=2, minutes=2),
    )
    runs_and_logs.append((r10, _logs_success(r10_id, "custom")))

    r11_id = _id()
    r11 = Run(
        id=r11_id,
        agent_id="custom",
        triggered_by="manual",
        status=RunStatus.success,
        input_params={"task": "Revisar dependencias desactualizadas en backend/pyproject.toml"},
        output="Dependencias revisadas. FastAPI 0.115 disponible (actual: 0.111). ARQ y SQLModel al día. Recomendado actualizar FastAPI en el próximo sprint.",
        tokens_input=1120,
        tokens_output=340,
        cost_usd=0.0024,
        started_at=_ago(days=1, hours=2, minutes=1),
        finished_at=_ago(days=1, hours=2),
        created_at=_ago(days=1, hours=2, minutes=2),
    )
    runs_and_logs.append((r11, _logs_success(r11_id, "custom")))

    r12_id = _id()
    r12 = Run(
        id=r12_id,
        agent_id="custom",
        triggered_by="manual",
        status=RunStatus.pending,
        input_params={"task": "Listar todos los TODOs pendientes en el código"},
        created_at=_ago(minutes=1),
    )
    runs_and_logs.append((r12, []))

    for run, logs in runs_and_logs:
        session.add(run)
        for log in logs:
            session.add(log)


def main() -> None:
    create_db_and_tables()
    seed_builtin_agents()

    with Session(engine) as session:
        existing = session.exec(select(Run)).first()
        if existing:
            print("La BD ya tiene runs — seed omitido. Borra la BD si quieres volver a seedear.")
            return

        schedule_ids = _seed_schedules(session)
        _seed_runs(session, schedule_ids)
        session.commit()

    print("Seed completado:")
    print("  • 3 schedules (code-review, portfolio-updater, vuln-scan)")
    print("  • 12 runs (code-review×4, portfolio-updater×3, vuln-scan×2, custom×3)")
    print("  • Logs para todos los runs con started_at")


if __name__ == "__main__":
    main()
