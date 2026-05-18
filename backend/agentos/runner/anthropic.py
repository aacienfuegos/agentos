import asyncio
import json
from dataclasses import dataclass
from datetime import datetime

import redis.asyncio as aioredis
from anthropic import AsyncAnthropic
from sqlmodel import Session

from ..config import settings
from ..database import engine
from ..models import Run, AgentDefinition, RunStatus, LogEntry
from ..tools import TOOL_REGISTRY, get_tool_schemas


@dataclass
class RunResult:
    output: str
    tokens_input: int
    tokens_output: int


class AnthropicRunner:
    def __init__(self, redis_url: str = settings.redis_url):
        self._redis_url = redis_url
        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self._cancelled = False

    async def run(self, run: Run, agent: AgentDefinition) -> RunResult:
        self._cancelled = False
        redis = aioredis.from_url(self._redis_url)

        # Listen for cancel signal
        cancel_sub = redis.pubsub()
        await cancel_sub.subscribe(f"run:{run.id}:cancel")

        messages: list[dict] = [
            {"role": "user", "content": self._build_user_message(run.input_params)}
        ]

        tools = get_tool_schemas(agent.tools)
        total_input = 0
        total_output = 0

        try:
            while True:
                # Check cancel
                msg = await cancel_sub.get_message(ignore_subscribe_messages=True)
                if msg or self._cancelled:
                    await self._publish(redis, run.id, "error", "Run cancelled")
                    raise asyncio.CancelledError()

                async with self._client.messages.stream(
                    model=agent.model,
                    max_tokens=agent.max_tokens,
                    system=agent.system_prompt,
                    tools=tools if tools else [],
                    messages=messages,
                ) as stream:
                    async for text in stream.text_stream:
                        await self._publish(redis, run.id, "info", text)

                    response = await stream.get_final_message()

                total_input += response.usage.input_tokens
                total_output += response.usage.output_tokens

                if response.stop_reason == "end_turn":
                    output = self._extract_text(response)
                    # Persist final output as a log entry for replay
                    with Session(engine) as session:
                        session.add(LogEntry(run_id=run.id, level="output", message=output))
                        session.commit()
                    await self._publish(redis, run.id, "done", output)
                    return RunResult(
                        output=output,
                        tokens_input=total_input,
                        tokens_output=total_output,
                    )

                if response.stop_reason == "tool_use":
                    tool_results = await self._execute_tools(redis, run.id, response.content, agent.tools)
                    messages = messages + [
                        {"role": "assistant", "content": response.content},
                        {"role": "user", "content": tool_results},
                    ]
                    continue

                # Unexpected stop reason
                break

        finally:
            await cancel_sub.unsubscribe(f"run:{run.id}:cancel")
            await redis.aclose()

        return RunResult(output="", tokens_input=total_input, tokens_output=total_output)

    async def _execute_tools(
        self,
        redis: aioredis.Redis,
        run_id: str,
        content: list,
        allowed_tools: list[str],
    ) -> list[dict]:
        results = []
        for block in content:
            if block.type != "tool_use":
                continue

            if block.name not in allowed_tools:
                result_content = f"Tool '{block.name}' is not allowed for this agent."
            else:
                await self._publish(redis, run_id, "tool_use", block.name, {
                    "tool": block.name, "input": block.input
                })
                try:
                    fn = TOOL_REGISTRY[block.name]
                    result_content = await fn(block.input)
                except Exception as e:
                    result_content = f"Tool error: {e}"

                await self._publish(redis, run_id, "tool_result", str(result_content)[:500], {
                    "tool": block.name
                })

            results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": str(result_content),
            })
        return results

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

        # Persist non-streaming events to DB so completed runs can replay logs
        if level not in ("info", "done"):
            with Session(engine) as session:
                entry = LogEntry(
                    run_id=run_id,
                    level=level,
                    message=message[:2000],
                    extra=metadata,
                )
                session.add(entry)
                session.commit()

    def _build_user_message(self, input_params: dict) -> str:
        if "user_message" in input_params:
            return input_params["user_message"]
        return json.dumps(input_params, ensure_ascii=False)

    def _extract_text(self, response) -> str:
        parts = []
        for block in response.content:
            if hasattr(block, "text"):
                parts.append(block.text)
        return "\n".join(parts)
