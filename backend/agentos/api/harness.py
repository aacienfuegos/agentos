import asyncio
import logging
import os
import stat
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

COMPONENT_TYPES = {"claude_md", "rule", "agent", "skill", "context", "script"}


def _root() -> Path:
    return Path(settings.harness_path).expanduser()


def _validate_name(name: str) -> None:
    if not name or "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "Nombre inválido")


def _component_path(component_type: str, name: str) -> Path:
    root = _root()
    if component_type == "claude_md":
        return root / "CLAUDE.md"
    if component_type == "rule":
        return root / "rules" / f"{name}.md"
    if component_type == "agent":
        return root / "agents" / f"{name}.md"
    if component_type == "skill":
        return root / "skills" / name / "SKILL.md"
    if component_type == "context":
        return root / "contexts" / f"{name}.md"
    if component_type == "script":
        return root / "scripts" / f"{name}.sh"
    raise HTTPException(400, f"Tipo desconocido: {component_type}")


def _parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    if not content.startswith("---\n"):
        return {}, content
    end = content.find("\n---\n", 4)
    if end == -1:
        return {}, content
    try:
        fm = yaml.safe_load(content[4:end]) or {}
    except yaml.YAMLError:
        fm = {}
    return fm, content[end + 5:]


def _list_type(component_type: str) -> list[dict[str, Any]]:
    root = _root()
    items: list[dict[str, Any]] = []

    if component_type == "claude_md":
        p = root / "CLAUDE.md"
        if p.exists():
            fm, _ = _parse_frontmatter(p.read_text(encoding="utf-8"))
            items.append({
                "name": "CLAUDE.md",
                "description": fm.get("description"),
                "modified_at": p.stat().st_mtime,
            })

    elif component_type == "rule":
        rules_dir = root / "rules"
        if rules_dir.exists():
            for p in sorted(rules_dir.glob("*.md")):
                fm, _ = _parse_frontmatter(p.read_text(encoding="utf-8"))
                items.append({
                    "name": p.stem,
                    "description": fm.get("description"),
                    "modified_at": p.stat().st_mtime,
                })

    elif component_type == "agent":
        agents_dir = root / "agents"
        if agents_dir.exists():
            for p in sorted(agents_dir.glob("*.md")):
                fm, _ = _parse_frontmatter(p.read_text(encoding="utf-8"))
                items.append({
                    "name": p.stem,
                    "description": fm.get("description"),
                    "modified_at": p.stat().st_mtime,
                })

    elif component_type == "skill":
        skills_dir = root / "skills"
        if skills_dir.exists():
            for skill_dir in sorted(skills_dir.iterdir()):
                skill_file = skill_dir / "SKILL.md"
                if skill_dir.is_dir() and skill_file.exists():
                    fm, _ = _parse_frontmatter(skill_file.read_text(encoding="utf-8"))
                    items.append({
                        "name": skill_dir.name,
                        "description": fm.get("description"),
                        "modified_at": skill_file.stat().st_mtime,
                    })

    elif component_type == "context":
        ctx_dir = root / "contexts"
        if ctx_dir.exists():
            for p in sorted(ctx_dir.glob("*.md")):
                fm, _ = _parse_frontmatter(p.read_text(encoding="utf-8"))
                items.append({
                    "name": p.stem,
                    "description": fm.get("description"),
                    "modified_at": p.stat().st_mtime,
                })

    elif component_type == "script":
        scripts_dir = root / "scripts"
        if scripts_dir.exists():
            for p in sorted(scripts_dir.glob("*.sh")):
                items.append({
                    "name": p.stem,
                    "description": None,
                    "modified_at": p.stat().st_mtime,
                })

    return items


class ComponentSummary(BaseModel):
    name: str
    description: str | None
    modified_at: float


class ComponentDetail(BaseModel):
    component_type: str
    name: str
    content: str
    metadata: dict[str, Any]
    modified_at: float


class HarnessListResponse(BaseModel):
    claude_md: list[ComponentSummary]
    rule: list[ComponentSummary]
    agent: list[ComponentSummary]
    skill: list[ComponentSummary]
    context: list[ComponentSummary]
    script: list[ComponentSummary]


class ComponentCreateRequest(BaseModel):
    name: str
    content: str


class ComponentUpdateRequest(BaseModel):
    content: str


class GenerateRequest(BaseModel):
    component_type: str
    description: str


class GenerateResponse(BaseModel):
    content: str


_GENERATE_PROMPTS: dict[str, str] = {
    "agent": """Generate an agent definition file for Claude Code.

Format EXACTLY as follows (the file must start with ---):
---
name: <agent-name-in-kebab-case>
description: <one-line description of what this agent does>
model: claude-sonnet-4-6
tools:
  - Read
  - Bash
---

<system prompt content here — explain the agent's role, expertise, rules and output format>

User request: {description}

Return ONLY the complete file content. No explanations, no markdown code blocks.""",

    "skill": """Generate a skill file for Claude Code.

Format EXACTLY as follows (the file must start with ---):
---
name: <skill-name-in-kebab-case>
description: <one-line description>
metadata:
  type: skill
---

# <Skill Title>

## Cuándo usar

<When to trigger this skill>

## Instrucciones

<Step-by-step instructions for the skill>

User request: {description}

Return ONLY the complete file content. No explanations, no markdown code blocks.""",

    "rule": """Generate a rules file for Claude Code (markdown format).
Rules files define behavior constraints and guidelines for the AI assistant.

Start with a # heading, then use ## sections for different rule categories.
Be specific and actionable. Use bullet points.

User request: {description}

Return ONLY the complete markdown content. No frontmatter. No explanations, no markdown code blocks wrapping the content.""",

    "context": """Generate a context file for Claude Code (markdown format).
Context files provide background information, references, or domain knowledge.

Start with a # heading describing the context topic.
Include relevant facts, patterns, and notes.

User request: {description}

Return ONLY the complete markdown content. No explanations, no markdown code blocks wrapping the content.""",

    "script": """Generate a bash script for Claude Code's scripts directory.

Format EXACTLY as follows:
#!/usr/bin/env bash
set -euo pipefail

# <one-line description of what the script does>

<script body>

Rules:
- Use set -euo pipefail
- No hardcoded credentials or secrets
- Use descriptive variable names
- Prefer portable POSIX constructs where possible

User request: {description}

Return ONLY the complete script content. No explanations, no markdown code blocks.""",
}


@router.post("/generate")
async def generate_component(req: GenerateRequest) -> GenerateResponse:
    if req.component_type not in _GENERATE_PROMPTS:
        raise HTTPException(400, f"Generación no disponible para tipo: {req.component_type}")
    if not req.description.strip():
        raise HTTPException(400, "La descripción no puede estar vacía")

    prompt = _GENERATE_PROMPTS[req.component_type].format(description=req.description.strip())

    env = {**os.environ, "HOME": str(Path.home())}
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", prompt,
            "--output-format", "text",
            "--no-session-persistence",
            "--model", "claude-sonnet-4-6",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Tiempo de espera agotado generando contenido")
    except Exception as e:
        logger.error("Error calling claude for generation: %s", e)
        raise HTTPException(500, "Error ejecutando generación")

    if proc.returncode != 0:
        logger.error("claude -p failed: %s", stderr.decode(errors="replace"))
        raise HTTPException(500, "Error en la generación del contenido")

    content = stdout.decode(errors="replace").strip()
    if not content:
        raise HTTPException(500, "La generación no produjo contenido")

    return GenerateResponse(content=content)


@router.get("")
def list_all() -> HarnessListResponse:
    return HarnessListResponse(
        claude_md=_list_type("claude_md"),
        rule=_list_type("rule"),
        agent=_list_type("agent"),
        skill=_list_type("skill"),
        context=_list_type("context"),
        script=_list_type("script"),
    )


@router.get("/{component_type}/{name}")
def get_component(component_type: str, name: str) -> ComponentDetail:
    if component_type not in COMPONENT_TYPES:
        raise HTTPException(400, f"Tipo desconocido: {component_type}")
    _validate_name(name)

    p = _component_path(component_type, name)
    if not p.exists():
        raise HTTPException(404, "Componente no encontrado")

    content = p.read_text(encoding="utf-8")
    fm, _ = _parse_frontmatter(content)

    return ComponentDetail(
        component_type=component_type,
        name=name,
        content=content,
        metadata=fm,
        modified_at=p.stat().st_mtime,
    )


@router.post("/{component_type}", status_code=201)
def create_component(component_type: str, req: ComponentCreateRequest) -> ComponentDetail:
    if component_type not in COMPONENT_TYPES:
        raise HTTPException(400, f"Tipo desconocido: {component_type}")
    if component_type == "claude_md":
        raise HTTPException(405, "CLAUDE.md es un singleton, usar PUT para actualizar")
    _validate_name(req.name)

    p = _component_path(component_type, req.name)
    if p.exists():
        raise HTTPException(409, f"Ya existe un componente con ese nombre")

    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(req.content, encoding="utf-8")

    if component_type == "script":
        p.chmod(p.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    fm, _ = _parse_frontmatter(req.content)
    return ComponentDetail(
        component_type=component_type,
        name=req.name,
        content=req.content,
        metadata=fm,
        modified_at=p.stat().st_mtime,
    )


@router.put("/{component_type}/{name}")
def update_component(component_type: str, name: str, req: ComponentUpdateRequest) -> ComponentDetail:
    if component_type not in COMPONENT_TYPES:
        raise HTTPException(400, f"Tipo desconocido: {component_type}")
    _validate_name(name)

    p = _component_path(component_type, name)
    if not p.exists():
        raise HTTPException(404, "Componente no encontrado")

    p.write_text(req.content, encoding="utf-8")

    fm, _ = _parse_frontmatter(req.content)
    return ComponentDetail(
        component_type=component_type,
        name=name,
        content=req.content,
        metadata=fm,
        modified_at=p.stat().st_mtime,
    )


@router.delete("/{component_type}/{name}", status_code=204)
def delete_component(component_type: str, name: str) -> None:
    if component_type not in COMPONENT_TYPES:
        raise HTTPException(400, f"Tipo desconocido: {component_type}")
    if component_type == "claude_md":
        raise HTTPException(405, "No se puede eliminar CLAUDE.md")
    _validate_name(name)

    p = _component_path(component_type, name)
    if not p.exists():
        raise HTTPException(404, "Componente no encontrado")

    if component_type == "skill":
        import shutil
        shutil.rmtree(p.parent)
    else:
        p.unlink()
