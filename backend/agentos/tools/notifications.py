import httpx

from ..config import settings


async def send_notification(
    params: dict | None = None,
    *,
    title: str = "AgentOS",
    message: str = "",
    priority: str = "default",
) -> str:
    if params:
        title = params.get("title", title)
        message = params.get("message", message)
        priority = params.get("priority", priority)

    if not settings.ntfy_url:
        return "Notifications not configured (NTFY_URL not set)"

    ntfy_priority = {"high": "high", "default": "default", "low": "low"}.get(priority, "default")

    async with httpx.AsyncClient() as client:
        r = await client.post(
            settings.ntfy_url,
            headers={
                "Title": title,
                "Priority": ntfy_priority,
                "Content-Type": "text/plain",
            },
            content=message.encode(),
        )
        r.raise_for_status()

    return f"Notification sent: {title}"
