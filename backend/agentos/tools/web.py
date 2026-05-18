import httpx


async def fetch_url(params: dict) -> str:
    url = params["url"]
    method = params.get("method", "GET").upper()
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        if method == "POST":
            r = await client.post(url, json=params.get("body"))
        else:
            r = await client.get(url)
    return r.text[:20_000]
