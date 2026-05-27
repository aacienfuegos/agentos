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
            "Usa la herramienta Bash con el CLI de `gh` para leer PRs y publicar comentarios. "
            "Comandos útiles: `gh pr diff <number> --repo <owner/repo>`, "
            "`gh pr view <number> --repo <owner/repo>`, "
            "`gh pr comment <number> --repo <owner/repo> --body <markdown>`. "
            "Sé específico y constructivo. Señala problemas reales, no estilo trivial. "
            "Sugiere el fix exacto cuando puedas. "
            "Formato de respuesta: markdown con secciones por fichero afectado. "
            "Prioriza: 1) bugs y errores de lógica, 2) problemas de seguridad, "
            "3) problemas de rendimiento, 4) mejoras de legibilidad. "
            "Si el PR está bien, dilo claramente."
        ),
        "tools": ["Bash"],
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
            "Usa Bash con `gh` CLI para leer repositorios y ficheros: "
            "`gh repo list <username> --json name,description,url,topics`, "
            "`gh api repos/<owner>/<repo>/readme`. "
            "Tu objetivo es generar descripciones precisas y personales de cada proyecto, "
            "en primera persona, con tono técnico pero cercano. "
            "Evita descripciones genéricas del tipo 'Este proyecto implementa...'. "
            "Escribe como lo haría el autor: qué problema resuelve, qué tecnología eligió y por qué. "
            "Siempre valida que el JSON final sea sintácticamente correcto antes de hacer push. "
            "Si el archivo actual no existe, créalo desde cero con un array vacío como base."
        ),
        "tools": ["Bash", "Read", "Write"],
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
            "Usa Bash para ejecutar herramientas de análisis (semgrep, gitleaks, npm audit, pip-audit). "
            "Analiza los resultados y genera un informe priorizado. "
            "Para cada vulnerabilidad: severidad (crítica/alta/media/baja), descripción clara, "
            "fichero y línea afectada, y remediación concreta. "
            "Ordena por severidad. Si encuentras vulnerabilidades críticas, destácalas al inicio. "
            "Formato: markdown con tabla resumen y secciones por categoría."
        ),
        "tools": ["Bash", "Read", "Write"],
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
        "tools": ["Bash", "Read", "Write", "WebFetch"],
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
        mutable_fields = {"name", "description", "system_prompt", "tools", "model", "max_tokens", "timeout_seconds", "is_builtin"}

        for data in all_agents:
            existing = session.get(AgentDefinition, data["id"])
            if existing:
                for field in mutable_fields:
                    if field in data:
                        setattr(existing, field, data[field])
                existing.updated_at = datetime.utcnow()
                session.add(existing)
            else:
                agent = AgentDefinition(**{
                    k: v for k, v in data.items()
                    if k in AgentDefinition.model_fields
                })
                session.add(agent)
        session.commit()
