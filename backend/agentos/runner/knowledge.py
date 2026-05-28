import json
from dataclasses import dataclass, field
from datetime import datetime

import anthropic
import redis.asyncio as aioredis
from sqlmodel import Session

from ..config import settings
from ..database import engine
from ..models import KnowledgeAgent, LogEntry, Run


@dataclass
class KnowledgeRunResult:
    output: str
    tokens_input: int = field(default=0)
    tokens_output: int = field(default=0)
    knowledge_doc_updated: bool = field(default=False)


_UPDATE_TOOL: anthropic.types.ToolParam = {
    "name": "update_knowledge_doc",
    "description": (
        "Actualiza la base de conocimiento con nueva información relevante aprendida "
        "durante la conversación. Usa solo cuando hay información nueva, una corrección "
        "o una mejora clara respecto al documento actual. No uses para cambios triviales."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "full_doc": {
                "type": "string",
                "description": "El documento de conocimiento completo y actualizado en Markdown.",
            }
        },
        "required": ["full_doc"],
    },
}


def _build_system_prompt(agent: KnowledgeAgent) -> str:
    base = agent.system_prompt or (
        f"Eres un asistente especializado en {agent.name}. "
        "Responde usando la base de conocimiento disponible. "
        "Sé preciso y cita el documento cuando sea relevante."
    )
    doc_section = (
        f"\n\n## Base de conocimiento: {agent.name}\n\n{agent.knowledge_doc}"
        if agent.knowledge_doc
        else ""
    )
    update_hint = (
        "\n\n---\n"
        "Si detectas información nueva o una corrección necesaria, "
        "usa la herramienta `update_knowledge_doc` con el documento completo actualizado. "
        "Después del update, menciona brevemente qué has actualizado."
    )
    return base + doc_section + update_hint


class KnowledgeRunner:
    def __init__(self, redis_url: str = settings.redis_url):
        self._redis_url = redis_url
        self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def run(self, run: Run, knowledge_agent: KnowledgeAgent) -> KnowledgeRunResult:
        redis = aioredis.from_url(self._redis_url)

        user_message = run.input_params.get("user_message", "")
        if not user_message:
            raise ValueError("input_params must contain 'user_message'")

        system_prompt = _build_system_prompt(knowledge_agent)
        messages: list[anthropic.types.MessageParam] = [
            {"role": "user", "content": user_message}
        ]

        output = ""
        tokens_input = 0
        tokens_output = 0
        doc_updated = False

        try:
            for _ in range(10):  # max tool-use iterations
                response = await self._client.messages.create(
                    model=knowledge_agent.model,
                    max_tokens=knowledge_agent.max_tokens,
                    system=system_prompt,
                    messages=messages,
                    tools=[_UPDATE_TOOL],
                )

                tokens_input += response.usage.input_tokens
                tokens_output += response.usage.output_tokens

                text_parts = [
                    block.text for block in response.content
                    if block.type == "text"
                ]
                if text_parts:
                    output = "\n".join(text_parts)

                tool_uses = [b for b in response.content if b.type == "tool_use"]

                if response.stop_reason == "end_turn" or not tool_uses:
                    await self._publish(redis, run.id, "info", output)
                    break

                messages.append({"role": "assistant", "content": response.content})  # type: ignore[arg-type]

                tool_results: list[anthropic.types.ToolResultBlockParam] = []
                for tool_use in tool_uses:
                    await self._publish(redis, run.id, "tool_use", tool_use.name, {"tool": tool_use.name})

                    if tool_use.name == "update_knowledge_doc":
                        new_doc = tool_use.input.get("full_doc", "")
                        self._update_knowledge_doc(knowledge_agent.id, new_doc)
                        knowledge_agent.knowledge_doc = new_doc
                        system_prompt = _build_system_prompt(knowledge_agent)
                        doc_updated = True
                        await self._publish(redis, run.id, "tool_result", "Documento actualizado.")
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use.id,
                            "content": "Documento de conocimiento actualizado correctamente.",
                        })
                    else:
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use.id,
                            "content": f"Tool '{tool_use.name}' not available.",
                            "is_error": True,
                        })

                messages.append({"role": "user", "content": tool_results})

            await self._publish(redis, run.id, "done", output)

        finally:
            await redis.aclose()

        return KnowledgeRunResult(
            output=output,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            knowledge_doc_updated=doc_updated,
        )

    def _update_knowledge_doc(self, agent_id: str, new_doc: str) -> None:
        with Session(engine) as session:
            agent = session.get(KnowledgeAgent, agent_id)
            if agent:
                agent.knowledge_doc = new_doc
                agent.updated_at = datetime.utcnow()
                session.add(agent)
                session.commit()

    async def _publish(
        self,
        redis: aioredis.Redis,
        run_id: str,
        level: str,
        message: str,
        metadata: dict | None = None,
    ) -> None:
        payload = json.dumps({"level": level, "message": message, "metadata": metadata})
        await redis.publish(f"run:{run_id}:logs", payload)

        if level not in ("done",):
            with Session(engine) as session:
                session.add(LogEntry(
                    run_id=run_id,
                    level=level,
                    message=message[:2000],
                    extra=metadata,
                ))
                session.commit()
