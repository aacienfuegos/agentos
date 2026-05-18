"""
Code review agent logic — system prompt and input builder.
The actual execution is handled by AnthropicRunner using the agent definition from DB.
This module provides helpers for the code review workflow.
"""
from datetime import datetime, timedelta

from sqlmodel import Session, select

from ..database import engine
from ..models import Run, RunStatus


SYSTEM_PROMPT = """Eres un senior software engineer revisando código. Tu objetivo es ayudar al equipo a mejorar la calidad del código.

Sé específico y constructivo:
- Señala problemas reales, no estilo trivial ni preferencias personales
- Sugiere el fix exacto cuando puedas (incluye el código corregido)
- Prioriza: 1) bugs y errores de lógica, 2) problemas de seguridad, 3) problemas de rendimiento, 4) mejoras de legibilidad
- Si el PR está bien, dilo claramente con un ✅

Formato de respuesta:
## Resumen
[Una línea describiendo el PR]

## Problemas encontrados
### 🔴 Crítico / 🟡 Importante / 🔵 Sugerencia
[Cada problema con: descripción, fichero:línea, y fix sugerido]

## Veredicto
[✅ Aprobado / ⚠️ Aprobado con cambios menores / ❌ Requiere cambios]"""


def was_recently_reviewed(repo: str, pr_number: int, within_minutes: int = 60) -> bool:
    """Check if a PR was already reviewed in the last N minutes to avoid duplicate reviews."""
    cutoff = datetime.utcnow() - timedelta(minutes=within_minutes)
    with Session(engine) as session:
        recent = session.exec(
            select(Run).where(
                Run.agent_id == "code-review",
                Run.status == RunStatus.success,
                Run.created_at >= cutoff,
            )
        ).all()

    for run in recent:
        params = run.input_params or {}
        if params.get("repo") == repo and str(params.get("pr_number")) == str(pr_number):
            return True
    return False


def build_review_message(repo: str, pr_number: int | None, focus: str = "all") -> str:
    """Build the user message for the code review agent."""
    if pr_number:
        return (
            f"Por favor revisa el PR #{pr_number} del repositorio {repo}.\n"
            f"Foco: {focus}\n\n"
            f"Pasos:\n"
            f"1. Obtén el diff del PR usando github_get_pr_diff\n"
            f"2. Analiza el código con el foco indicado\n"
            f"3. Publica tu review como comentario en el PR usando github_post_comment\n"
            f"4. Retorna el resumen del review"
        )
    return (
        f"Por favor revisa todos los PRs abiertos del repositorio {repo}.\n"
        f"Foco: {focus}\n\n"
        f"Pasos:\n"
        f"1. Lista los PRs abiertos usando github_list_prs\n"
        f"2. Para cada PR, obtén el diff y analiza el código\n"
        f"3. Publica tu review como comentario en cada PR\n"
        f"4. Retorna un resumen de todos los PRs revisados"
    )
