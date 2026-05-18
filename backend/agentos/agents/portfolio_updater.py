"""
Portfolio updater agent helper — builds the structured user message
that drives the agentic loop.
"""
from __future__ import annotations

import json
from datetime import datetime


def build_portfolio_message(params: dict) -> str:
    github_username = params.get("github_username", "")
    portfolio_repo = params.get("portfolio_repo", "")
    content_path = params.get("content_path", "data/projects.json")
    languages = params.get("languages", [])
    max_projects = int(params.get("max_projects", 10))
    skip_repos = params.get("skip_repos", [])

    if not github_username:
        raise ValueError("github_username is required")
    if not portfolio_repo:
        raise ValueError("portfolio_repo is required")

    lang_filter = ""
    if languages:
        lang_filter = f"\nFiltra para incluir preferiblemente proyectos en: {', '.join(languages)}."

    skip_note = ""
    if skip_repos:
        skip_note = f"\nExcluye estos repos: {', '.join(skip_repos)}."

    return (
        f"Actualiza el portfolio de **{github_username}**.\n\n"
        f"**Pasos a seguir:**\n"
        f"1. Usa `github_list_repos` con username=`{github_username}` para obtener la lista de repos públicos.\n"
        f"2. Elige los {max_projects} más interesantes (por estrellas, tecnología, propósito único).{lang_filter}{skip_note}\n"
        f"3. Para cada repo seleccionado, usa `github_get_file` (repo=`{github_username}/<nombre>`, "
        f"path=`README.md`) para leer el README. Si el README no existe, usa la descripción del repo.\n"
        f"4. Lee el archivo actual del portfolio: repo=`{portfolio_repo}`, path=`{content_path}`.\n"
        f"5. Genera un JSON actualizado con el array de proyectos. Cada proyecto debe tener:\n"
        f"   - `name`: nombre del repo\n"
        f"   - `description`: 2-3 frases en primera persona, tono personal y técnico\n"
        f"   - `tech`: array de tecnologías principales\n"
        f"   - `url`: URL del repo en GitHub\n"
        f"   - `stars`: número de estrellas\n"
        f"   - `updated_at`: fecha del último push (ISO 8601)\n"
        f"   - `highlight`: una frase corta de lo que lo hace especial\n"
        f"6. Usa `github_push_file` para guardar el JSON actualizado en repo=`{portfolio_repo}`, "
        f"path=`{content_path}`, con un commit message descriptivo.\n\n"
        f"**Criterios para las descripciones:**\n"
        f"- Escribe en primera persona (\"Construí...\", \"Implementé...\")\n"
        f"- Menciona el problema que resuelve y la solución técnica\n"
        f"- Evita genéricos. Destaca lo específico y lo que aprendiste\n"
        f"- Máximo 2-3 frases por proyecto\n\n"
        f"Fecha actual: {datetime.utcnow().strftime('%Y-%m-%d')}"
    )
