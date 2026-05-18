import logging
from pathlib import Path

import yaml
from sqlmodel import Session

from ..database import engine
from ..models import AgentDefinition

logger = logging.getLogger(__name__)

AGENTS_CONFIG_DIR = Path("/app/agents_config")

BUILTIN_AGENTS: list[dict] = [
    {
        "id": "code-review",
        "name": "Code Review",
        "description": "Revisa PRs de GitHub y publica comentarios con análisis detallado de calidad, bugs y seguridad.",
        "system_prompt": (
            "Eres un senior software engineer revisando código. "
            "Sé específico y constructivo. Señala problemas reales, no estilo trivial. "
            "Sugiere el fix exacto cuando puedas. "
            "Formato de respuesta: markdown con secciones por fichero afectado. "
            "Prioriza: 1) bugs y errores de lógica, 2) problemas de seguridad, "
            "3) problemas de rendimiento, 4) mejoras de legibilidad. "
            "Si el PR está bien, dilo claramente."
        ),
        "tools": [
            "github_list_prs", "github_get_pr_diff", "github_post_comment",
            "github_list_issues",
        ],
        "model": "claude-sonnet-4-6",
        "max_tokens": 8192,
        "timeout_seconds": 300,
        "is_builtin": True,
    },
    {
        "id": "portfolio-updater",
        "name": "Portfolio Updater",
        "description": "Actualiza automáticamente el JSON de proyectos del portfolio leyendo repos públicos de GitHub.",
        "system_prompt": (
            "Eres un asistente que actualiza el portfolio personal de un desarrollador. "
            "Lee los repositorios públicos, extrae lo más interesante de cada uno "
            "(tecnologías, propósito, lo que lo hace especial) y genera descripciones "
            "en primera persona, en tono personal y técnico. "
            "Evita descripciones genéricas. Resalta lo que aprendiste o lo que es único. "
            "Formato de salida: JSON válido con el array de proyectos actualizado."
        ),
        "tools": [
            "github_list_prs", "github_get_file", "github_push_file",
            "fetch_url",
        ],
        "model": "claude-sonnet-4-6",
        "max_tokens": 8192,
        "timeout_seconds": 600,
        "is_builtin": True,
    },
    {
        "id": "vuln-scan",
        "name": "Vulnerability Scanner",
        "description": "Escanea vulnerabilidades en repos usando semgrep, gitleaks y npm/pip audit en contenedor aislado.",
        "system_prompt": (
            "Eres un experto en seguridad de software analizando vulnerabilidades. "
            "Analiza los resultados de las herramientas de escaneo y genera un informe priorizado. "
            "Para cada vulnerabilidad: severidad (crítica/alta/media/baja), descripción clara, "
            "fichero y línea afectada, y remediación concreta. "
            "Ordena por severidad. Si encuentras vulnerabilidades críticas, destácalas al inicio. "
            "Formato: markdown con tabla resumen y secciones por categoría."
        ),
        "tools": ["run_command", "read_file", "write_file", "github_list_issues", "github_post_comment"],
        "model": "claude-sonnet-4-6",
        "max_tokens": 8192,
        "timeout_seconds": 900,
        "is_builtin": True,
    },
    {
        "id": "custom",
        "name": "Tarea personalizada",
        "description": "Agente genérico para tareas ad-hoc. Define el prompt y las tools en los parámetros.",
        "system_prompt": (
            "Eres un asistente de desarrollo de software. "
            "Completa la tarea que se te pide de forma precisa y eficiente. "
            "Si necesitas más información, pregunta antes de actuar."
        ),
        "tools": [
            "read_file", "write_file", "list_directory", "run_command",
            "fetch_url", "github_list_prs", "github_get_file",
        ],
        "model": "claude-sonnet-4-6",
        "max_tokens": 4096,
        "timeout_seconds": 300,
        "is_builtin": True,
    },
]


def _load_yaml_agents() -> list[dict]:
    agents = []
    if not AGENTS_CONFIG_DIR.exists():
        return agents
    for path in sorted(AGENTS_CONFIG_DIR.glob("*.yaml")) + sorted(AGENTS_CONFIG_DIR.glob("*.yml")):
        try:
            with open(path) as f:
                data = yaml.safe_load(f)
            if not isinstance(data, dict) or "id" not in data:
                logger.warning("Skipping %s: missing 'id' field", path.name)
                continue
            data.setdefault("is_builtin", False)
            agents.append(data)
            logger.info("Loaded agent '%s' from %s", data["id"], path.name)
        except Exception as e:
            logger.error("Error loading agent from %s: %s", path.name, e)
    return agents


def seed_builtin_agents() -> None:
    from datetime import datetime

    all_agents = BUILTIN_AGENTS + _load_yaml_agents()

    with Session(engine) as session:
        for data in all_agents:
            existing = session.get(AgentDefinition, data["id"])
            if existing:
                existing.name = data.get("name", existing.name)
                existing.description = data.get("description", existing.description)
                existing.is_builtin = data.get("is_builtin", existing.is_builtin)
                session.add(existing)
            else:
                agent = AgentDefinition(**{
                    k: v for k, v in data.items()
                    if k in AgentDefinition.model_fields
                })
                session.add(agent)
        session.commit()
