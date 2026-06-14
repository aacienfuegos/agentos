import asyncio
import json
import os
from dataclasses import dataclass, field

import redis.asyncio as aioredis
from sqlmodel import Session

from ..config import settings
from ..database import engine
from ..models import LogEntry


@dataclass
class RunResult:
    output: str
    tokens_input: int = field(default=0)
    tokens_output: int = field(default=0)
    tokens_cache_read: int = field(default=0)
    tokens_cache_write: int = field(default=0)
    session_id: str | None = field(default=None)


class ClaudeCodeRunner:
    def __init__(self, redis_url: str = settings.redis_url):
        self._redis_url = redis_url

    async def run(
        self,
        run,
        agent,
        persist_session: bool = False,
        resume_session_id: str | None = None,
        cwd: str | None = None,
    ) -> RunResult:
        redis = aioredis.from_url(self._redis_url)
        cancel_sub = redis.pubsub()
        await cancel_sub.subscribe(f"run:{run.id}:cancel")

        cmd = [
            "claude",
            "-p", self._build_user_message(run.input_params, agent.id),
            "--output-format", "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
        ]

        if resume_session_id:
            cmd.extend(["--resume", resume_session_id])
        else:
            # Solo inyectar system prompt al iniciar sesión nueva, no al reanudar
            if agent.system_prompt:
                cmd.extend(["--system-prompt", agent.system_prompt])
            if not persist_session:
                cmd.append("--no-session-persistence")

        if agent.model:
            cmd.extend(["--model", agent.model])
        if agent.tools:
            cmd.extend(["--tools", ",".join(agent.tools)])

        env = {**os.environ}
        if settings.github_token:
            env["GITHUB_TOKEN"] = settings.github_token

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=cwd,
        )

        output = ""
        tokens_input = 0
        tokens_output = 0
        tokens_cache_read = 0
        tokens_cache_write = 0
        session_id: str | None = None

        try:
            async for raw_line in process.stdout:
                cancel_msg = await cancel_sub.get_message(ignore_subscribe_messages=True)
                if cancel_msg:
                    process.terminate()
                    raise asyncio.CancelledError()

                line = raw_line.decode().strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if event.get("type") == "result":
                    output = event.get("result", "")
                    usage = event.get("usage", {})
                    tokens_input = usage.get("input_tokens", 0)
                    tokens_output = usage.get("output_tokens", 0)
                    tokens_cache_read = usage.get("cache_read_input_tokens", 0)
                    tokens_cache_write = usage.get("cache_write_input_tokens", 0)
                    session_id = event.get("session_id")

                await self._handle_event(redis, run.id, event, output)

            await process.wait()

            if process.returncode not in (0, None):
                stderr = (await process.stderr.read()).decode()
                raise RuntimeError(stderr or f"claude exited with code {process.returncode}")

        finally:
            await cancel_sub.unsubscribe(f"run:{run.id}:cancel")
            await redis.aclose()
            if process.returncode is None:
                process.terminate()

        return RunResult(
            output=output,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            tokens_cache_read=tokens_cache_read,
            tokens_cache_write=tokens_cache_write,
            session_id=session_id,
        )

    async def _handle_event(
        self, redis: aioredis.Redis, run_id: str, event: dict, final_output: str
    ) -> None:
        event_type = event.get("type")

        if event_type == "assistant":
            for block in event.get("message", {}).get("content", []):
                if block.get("type") == "text":
                    await self._publish(redis, run_id, "info", block["text"])
                elif block.get("type") == "tool_use":
                    await self._publish(redis, run_id, "tool_use", block["name"], {
                        "tool": block["name"], "input": block.get("input"),
                    })

        elif event_type == "user":
            for block in event.get("message", {}).get("content", []):
                if block.get("type") == "tool_result":
                    content = block.get("content", "")
                    if isinstance(content, list):
                        content = " ".join(
                            b.get("text", "") for b in content if isinstance(b, dict)
                        )
                    await self._publish(redis, run_id, "tool_result", str(content)[:500])

        elif event_type == "result":
            is_error = event.get("is_error", False)
            if is_error:
                await self._publish(redis, run_id, "error", final_output)
            else:
                with Session(engine) as session:
                    session.add(LogEntry(run_id=run_id, level="output", message=final_output))
                    session.commit()
                await self._publish(redis, run_id, "done", final_output)

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

    def _build_user_message(self, input_params: dict, agent_id: str = "") -> str:
        from ..agents.portfolio_updater import build_portfolio_message
        if agent_id == "portfolio-updater":
            return build_portfolio_message(input_params)
        if "user_message" in input_params:
            return input_params["user_message"]
        return json.dumps(input_params, ensure_ascii=False)
