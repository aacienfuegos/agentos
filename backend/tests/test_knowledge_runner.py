"""Unit tests for runner/knowledge.py — system prompt generation, dir tree, ensure_knowledge_dir."""
from pathlib import Path

import pytest

from unittest.mock import patch

from agentos.models import KnowledgeBase, Run
from agentos.runner.knowledge import (
    KnowledgeRunner,
    _build_system_prompt,
    _dir_tree,
    ensure_knowledge_dir,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _kb(
    *,
    name: str = "TestKB",
    description: str = "Una KB de prueba",
    knowledge_path: str = "/nonexistent/path",
    instructions: dict | None = None,
) -> KnowledgeBase:
    return KnowledgeBase(
        id="test-kb",
        name=name,
        description=description,
        knowledge_path=knowledge_path,
        instructions=instructions or {},
    )


# ---------------------------------------------------------------------------
# _build_system_prompt — mode="chat", path missing
# ---------------------------------------------------------------------------

class TestBuildSystemPromptPathMissing:
    def test_includes_warning_when_dir_missing(self):
        kb = _kb(knowledge_path="/nonexistent/does-not-exist")
        result = _build_system_prompt(kb)
        assert "**Aviso:**" in result
        assert "/nonexistent/does-not-exist" in result

    def test_includes_generic_opener_when_dir_missing(self):
        kb = _kb(name="MiKB", knowledge_path="/nonexistent/does-not-exist")
        result = _build_system_prompt(kb)
        assert "MiKB" in result
        assert "asistente especializado" in result

    def test_free_text_used_instead_of_generic_opener(self):
        kb = _kb(
            knowledge_path="/nonexistent/does-not-exist",
            instructions={"free_text": "Eres el arquitecto del sistema."},
        )
        result = _build_system_prompt(kb)
        assert "Eres el arquitecto del sistema." in result
        assert "asistente especializado" not in result

    def test_no_role_in_context_mode_missing_path(self):
        kb = _kb(knowledge_path="/nonexistent/does-not-exist")
        result = _build_system_prompt(kb, mode="context")
        assert "asistente especializado" not in result
        assert "**Aviso:**" not in result

    def test_constraints_appear_even_when_dir_missing(self):
        kb = _kb(
            knowledge_path="/nonexistent/does-not-exist",
            instructions={"cite_verbatim": True},
        )
        result = _build_system_prompt(kb)
        assert "Cita siempre textualmente" in result

    def test_returns_string(self):
        kb = _kb(knowledge_path="/nonexistent/does-not-exist")
        assert isinstance(_build_system_prompt(kb), str)


# ---------------------------------------------------------------------------
# _build_system_prompt — mode="chat", path exists
# ---------------------------------------------------------------------------

class TestBuildSystemPromptChatMode:
    def test_no_free_text_uses_generic_opener(self, tmp_path: Path):
        kb = _kb(name="MiKB", knowledge_path=str(tmp_path))
        result = _build_system_prompt(kb)
        assert "asistente especializado en MiKB" in result

    def test_free_text_replaces_generic_opener(self, tmp_path: Path):
        kb = _kb(
            knowledge_path=str(tmp_path),
            instructions={"free_text": "Eres un experto en redes."},
        )
        result = _build_system_prompt(kb)
        assert "Eres un experto en redes." in result
        assert "asistente especializado" not in result

    def test_empty_free_text_falls_back_to_generic_opener(self, tmp_path: Path):
        kb = _kb(
            name="MiKB",
            knowledge_path=str(tmp_path),
            instructions={"free_text": "   "},
        )
        result = _build_system_prompt(kb)
        assert "asistente especializado en MiKB" in result

    def test_knowledge_index_injected_when_present(self, tmp_path: Path):
        (tmp_path / "knowledge.md").write_text("# Índice\n\nnota.md → Notas generales\n", encoding="utf-8")
        kb = _kb(knowledge_path=str(tmp_path))
        result = _build_system_prompt(kb)
        assert "## Índice de la base de conocimiento" in result
        assert "nota.md → Notas generales" in result

    def test_knowledge_index_skipped_when_absent(self, tmp_path: Path):
        kb = _kb(knowledge_path=str(tmp_path))
        result = _build_system_prompt(kb)
        assert "## Índice de la base de conocimiento" not in result

    def test_knowledge_index_skipped_when_empty(self, tmp_path: Path):
        (tmp_path / "knowledge.md").write_text("   \n", encoding="utf-8")
        kb = _kb(knowledge_path=str(tmp_path))
        result = _build_system_prompt(kb)
        assert "## Índice de la base de conocimiento" not in result

    def test_tree_section_always_present(self, tmp_path: Path):
        kb = _kb(name="MiKB", knowledge_path=str(tmp_path))
        result = _build_system_prompt(kb)
        assert "## Base de conocimiento: MiKB" in result
        assert "Estructura actual:" in result

    def test_maintenance_instruction_present_when_not_readonly(self, tmp_path: Path):
        kb = _kb(knowledge_path=str(tmp_path), instructions={"readonly": False})
        result = _build_system_prompt(kb)
        assert "Mantenimiento del índice" in result

    def test_maintenance_instruction_absent_when_readonly(self, tmp_path: Path):
        kb = _kb(knowledge_path=str(tmp_path), instructions={"readonly": True})
        result = _build_system_prompt(kb)
        assert "Mantenimiento del índice" not in result

    def test_readonly_constraint_added(self, tmp_path: Path):
        kb = _kb(knowledge_path=str(tmp_path), instructions={"readonly": True})
        result = _build_system_prompt(kb)
        assert "No modifiques ni crees ficheros" in result


# ---------------------------------------------------------------------------
# _build_system_prompt — constraints
# ---------------------------------------------------------------------------

class TestBuildSystemPromptConstraints:
    @pytest.mark.parametrize("flag,expected_fragment", [
        ("cite_verbatim",       "Cita siempre textualmente"),
        ("no_recommendations",  "No hagas recomendaciones"),
        ("require_source_refs", "Indica siempre el archivo o sección fuente"),
        ("readonly",            "No modifiques ni crees ficheros"),
    ])
    def test_each_constraint_flag(self, tmp_path: Path, flag: str, expected_fragment: str):
        kb = _kb(knowledge_path=str(tmp_path), instructions={flag: True})
        result = _build_system_prompt(kb)
        assert expected_fragment in result

    def test_no_constraints_section_when_all_false(self, tmp_path: Path):
        kb = _kb(
            knowledge_path=str(tmp_path),
            instructions={
                "cite_verbatim": False,
                "no_recommendations": False,
                "require_source_refs": False,
                "readonly": False,
            },
        )
        result = _build_system_prompt(kb)
        assert "Instrucciones:" not in result

    def test_multiple_constraints_all_present(self, tmp_path: Path):
        kb = _kb(
            knowledge_path=str(tmp_path),
            instructions={"cite_verbatim": True, "no_recommendations": True},
        )
        result = _build_system_prompt(kb)
        assert "Cita siempre textualmente" in result
        assert "No hagas recomendaciones" in result


# ---------------------------------------------------------------------------
# _build_system_prompt — mode="context"
# ---------------------------------------------------------------------------

class TestBuildSystemPromptContextMode:
    def test_no_role_or_opener(self, tmp_path: Path):
        kb = _kb(name="MiKB", knowledge_path=str(tmp_path))
        result = _build_system_prompt(kb, mode="context")
        assert "asistente especializado" not in result

    def test_free_text_not_included(self, tmp_path: Path):
        kb = _kb(
            knowledge_path=str(tmp_path),
            instructions={"free_text": "Eres el arquitecto."},
        )
        result = _build_system_prompt(kb, mode="context")
        assert "Eres el arquitecto." not in result

    def test_tree_section_present(self, tmp_path: Path):
        kb = _kb(name="MiKB", knowledge_path=str(tmp_path))
        result = _build_system_prompt(kb, mode="context")
        assert "## Base de conocimiento: MiKB" in result

    def test_knowledge_index_injected(self, tmp_path: Path):
        (tmp_path / "knowledge.md").write_text("nota.md → Notas\n", encoding="utf-8")
        kb = _kb(knowledge_path=str(tmp_path))
        result = _build_system_prompt(kb, mode="context")
        assert "nota.md → Notas" in result

    def test_constraints_still_present(self, tmp_path: Path):
        kb = _kb(
            knowledge_path=str(tmp_path),
            instructions={"cite_verbatim": True},
        )
        result = _build_system_prompt(kb, mode="context")
        assert "Cita siempre textualmente" in result

    def test_maintenance_instruction_present_when_not_readonly(self, tmp_path: Path):
        kb = _kb(knowledge_path=str(tmp_path), instructions={"readonly": False})
        result = _build_system_prompt(kb, mode="context")
        assert "Mantenimiento del índice" in result


# ---------------------------------------------------------------------------
# _dir_tree
# ---------------------------------------------------------------------------

class TestDirTree:
    def test_root_path_in_output(self, tmp_path: Path):
        result = _dir_tree(tmp_path)
        assert str(tmp_path) in result

    def test_lists_files_and_dirs(self, tmp_path: Path):
        (tmp_path / "readme.md").write_text("x")
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "child.md").write_text("y")
        result = _dir_tree(tmp_path)
        assert "readme.md" in result
        assert "sub" in result
        assert "child.md" in result

    def test_hidden_files_excluded(self, tmp_path: Path):
        (tmp_path / ".hidden").write_text("x")
        (tmp_path / "visible.md").write_text("y")
        result = _dir_tree(tmp_path)
        assert ".hidden" not in result
        assert "visible.md" in result

    def test_skipped_dirs_excluded(self, tmp_path: Path):
        (tmp_path / ".git").mkdir()
        (tmp_path / ".git" / "HEAD").write_text("ref: refs/heads/main")
        (tmp_path / "normal.md").write_text("x")
        result = _dir_tree(tmp_path)
        assert ".git" not in result
        assert "normal.md" in result

    def test_depth_limit_respected(self, tmp_path: Path):
        deep = tmp_path / "a" / "b" / "c" / "d" / "e" / "f"
        deep.mkdir(parents=True)
        (deep / "deep.md").write_text("x")
        result = _dir_tree(tmp_path, max_depth=3)
        assert "deep.md" not in result

    def test_max_files_truncation_marker(self, tmp_path: Path):
        for i in range(200):
            (tmp_path / f"file_{i:03d}.md").write_text("x")
        result = _dir_tree(tmp_path)
        assert "omitidos" in result

    def test_empty_dir_no_children(self, tmp_path: Path):
        result = _dir_tree(tmp_path)
        lines = result.strip().splitlines()
        assert len(lines) == 1
        assert str(tmp_path) in lines[0]

    def test_returns_string(self, tmp_path: Path):
        assert isinstance(_dir_tree(tmp_path), str)


# ---------------------------------------------------------------------------
# ensure_knowledge_dir
# ---------------------------------------------------------------------------

class TestEnsureKnowledgeDir:
    def test_creates_directory(self, tmp_path: Path):
        target = tmp_path / "newkb"
        assert not target.exists()
        kb = _kb(knowledge_path=str(target))
        ensure_knowledge_dir(kb)
        assert target.is_dir()

    def test_creates_stub_when_empty(self, tmp_path: Path):
        target = tmp_path / "newkb"
        kb = _kb(name="MiKB", description="Una descripción", knowledge_path=str(target))
        ensure_knowledge_dir(kb)
        stub = target / "knowledge.md"
        assert stub.exists()
        content = stub.read_text(encoding="utf-8")
        assert "MiKB" in content
        assert "Una descripción" in content

    def test_no_stub_when_dir_has_files(self, tmp_path: Path):
        target = tmp_path / "existing"
        target.mkdir()
        (target / "notas.md").write_text("algo", encoding="utf-8")
        kb = _kb(knowledge_path=str(target))
        ensure_knowledge_dir(kb)
        assert not (target / "knowledge.md").exists()

    def test_existing_stub_not_overwritten(self, tmp_path: Path):
        target = tmp_path / "kb"
        target.mkdir()
        (target / "knowledge.md").write_text("# Contenido existente\n", encoding="utf-8")
        kb = _kb(knowledge_path=str(target))
        ensure_knowledge_dir(kb)
        assert "# Contenido existente" in (target / "knowledge.md").read_text(encoding="utf-8")

    def test_returns_path(self, tmp_path: Path):
        target = tmp_path / "newkb"
        kb = _kb(knowledge_path=str(target))
        result = ensure_knowledge_dir(kb)
        assert isinstance(result, Path)
        assert result == target

    def test_parents_created(self, tmp_path: Path):
        target = tmp_path / "a" / "b" / "c"
        kb = _kb(knowledge_path=str(target))
        ensure_knowledge_dir(kb)
        assert target.is_dir()

    def test_idempotent(self, tmp_path: Path):
        kb = _kb(knowledge_path=str(tmp_path / "kb"))
        ensure_knowledge_dir(kb)
        ensure_knowledge_dir(kb)
        assert (tmp_path / "kb").is_dir()


# ---------------------------------------------------------------------------
# KnowledgeRunner — tools enforcement
# ---------------------------------------------------------------------------

class TestKnowledgeRunnerTools:
    def _make_run(self, kb_id: str = "test-kb") -> Run:
        return Run(agent_id=f"knowledge:{kb_id}", input_params={"user_message": "hola"})

    @pytest.mark.asyncio
    async def test_readonly_forces_read_only_tools(self, tmp_path: Path):
        kb = _kb(knowledge_path=str(tmp_path), instructions={"readonly": True})
        run = self._make_run()
        captured: dict = {}

        from agentos.runner.claude_code import RunResult

        async def _fake_run(self, run, agent_def, **kwargs):
            captured["tools"] = agent_def.tools
            return RunResult(output="ok", tokens_input=1, tokens_output=1)

        with (
            patch("agentos.runner.knowledge.ClaudeCodeRunner.run", new=_fake_run),
            patch("agentos.runner.knowledge.Session"),
        ):
            runner = KnowledgeRunner(redis_url="redis://localhost:6379")
            await runner.run(run, kb)

        assert "Write" not in captured["tools"]
        assert "Edit" not in captured["tools"]
        assert "Bash" not in captured["tools"]
        assert "Read" in captured["tools"]

    @pytest.mark.asyncio
    async def test_non_readonly_uses_input_params_tools(self, tmp_path: Path):
        kb = _kb(knowledge_path=str(tmp_path), instructions={"readonly": False})
        run = self._make_run()
        run.input_params["tools"] = ["Read", "Write", "Edit"]
        captured: dict = {}

        from agentos.runner.claude_code import RunResult

        async def _fake_run(self, run, agent_def, **kwargs):
            captured["tools"] = agent_def.tools
            return RunResult(output="ok", tokens_input=1, tokens_output=1)

        with (
            patch("agentos.runner.knowledge.ClaudeCodeRunner.run", new=_fake_run),
            patch("agentos.runner.knowledge.Session"),
        ):
            runner = KnowledgeRunner(redis_url="redis://localhost:6379")
            await runner.run(run, kb)

        assert captured["tools"] == ["Read", "Write", "Edit"]

    @pytest.mark.asyncio
    async def test_non_readonly_defaults_to_read_write(self, tmp_path: Path):
        kb = _kb(knowledge_path=str(tmp_path), instructions={})
        run = self._make_run()
        captured: dict = {}

        from agentos.runner.claude_code import RunResult

        async def _fake_run(self, run, agent_def, **kwargs):
            captured["tools"] = agent_def.tools
            return RunResult(output="ok", tokens_input=1, tokens_output=1)

        with (
            patch("agentos.runner.knowledge.ClaudeCodeRunner.run", new=_fake_run),
            patch("agentos.runner.knowledge.Session"),
        ):
            runner = KnowledgeRunner(redis_url="redis://localhost:6379")
            await runner.run(run, kb)

        assert captured["tools"] == ["Read", "Write"]
