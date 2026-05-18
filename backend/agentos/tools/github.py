import base64
import httpx

from ..config import settings

GITHUB_API = "https://api.github.com"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def github_list_prs(params: dict) -> str:
    repo = params["repo"]
    state = params.get("state", "open")
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{GITHUB_API}/repos/{repo}/pulls",
            headers=_headers(),
            params={"state": state, "per_page": 30},
        )
        r.raise_for_status()
        prs = r.json()
    lines = [f"#{p['number']}: {p['title']} (@{p['user']['login']})" for p in prs]
    return "\n".join(lines) if lines else "No pull requests found."


async def github_get_pr_diff(params: dict) -> str:
    repo = params["repo"]
    pr_number = params["pr_number"]
    headers = {**_headers(), "Accept": "application/vnd.github.diff"}
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{GITHUB_API}/repos/{repo}/pulls/{pr_number}",
            headers=headers,
        )
        r.raise_for_status()
    return r.text[:100_000]  # cap at 100k chars


async def github_post_comment(params: dict) -> str:
    repo = params["repo"]
    issue_number = params["issue_number"]
    body = params["body"]
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{GITHUB_API}/repos/{repo}/issues/{issue_number}/comments",
            headers=_headers(),
            json={"body": body},
        )
        r.raise_for_status()
        comment = r.json()
    return f"Comment posted: {comment['html_url']}"


async def github_list_issues(params: dict) -> str:
    repo = params["repo"]
    state = params.get("state", "open")
    labels = params.get("labels", "")
    query_params = {"state": state, "per_page": 50}
    if labels:
        query_params["labels"] = labels
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{GITHUB_API}/repos/{repo}/issues",
            headers=_headers(),
            params=query_params,
        )
        r.raise_for_status()
        issues = [i for i in r.json() if "pull_request" not in i]
    lines = [f"#{i['number']}: {i['title']}" for i in issues]
    return "\n".join(lines) if lines else "No issues found."


async def github_get_file(params: dict) -> str:
    repo = params["repo"]
    path = params["path"]
    ref = params.get("ref", "main")
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{GITHUB_API}/repos/{repo}/contents/{path}",
            headers=_headers(),
            params={"ref": ref},
        )
        r.raise_for_status()
        data = r.json()
    content = base64.b64decode(data["content"]).decode(errors="replace")
    return content[:50_000]


async def github_push_file(params: dict) -> str:
    repo = params["repo"]
    path = params["path"]
    content = params["content"]
    message = params["message"]
    branch = params.get("branch", "main")

    encoded = base64.b64encode(content.encode()).decode()

    # Get current SHA if file exists
    sha = None
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{GITHUB_API}/repos/{repo}/contents/{path}",
            headers=_headers(),
            params={"ref": branch},
        )
        if r.status_code == 200:
            sha = r.json().get("sha")

        payload: dict = {"message": message, "content": encoded, "branch": branch}
        if sha:
            payload["sha"] = sha

        r = await client.put(
            f"{GITHUB_API}/repos/{repo}/contents/{path}",
            headers=_headers(),
            json=payload,
        )
        r.raise_for_status()
        data = r.json()

    return f"File pushed: {data['content']['html_url']}"
