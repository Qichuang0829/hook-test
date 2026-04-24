from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "3100"))
MAX_BODY_SIZE = 5 * 1024 * 1024
BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"
LOG_FILES = {
    "llm_output": LOG_DIR / "llm_output.log",
    "agent_end": LOG_DIR / "agent_end.log",
}

LOG_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="hook-test", version="1.0.0")


def append_log(log_file_path: Path, entry: dict) -> None:
    with log_file_path.open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps(entry, ensure_ascii=False) + "\n")


def parse_payload(raw_body: str) -> tuple[object | None, str | None]:
    if not raw_body:
        return None, None

    try:
        return json.loads(raw_body), None
    except json.JSONDecodeError:
        return None, raw_body


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


async def record_event(request: Request, event_name: str) -> dict:
    body = await request.body()
    if len(body) > MAX_BODY_SIZE:
        raise HTTPException(status_code=413, detail="Payload too large")

    raw_body = body.decode("utf-8", errors="replace")
    payload, payload_text = parse_payload(raw_body)
    entry = {
        "receivedAt": datetime.now(timezone.utc).isoformat(),
        "eventName": event_name,
        "request": {
            "method": request.method,
            "path": str(request.url.path),
            "headers": dict(request.headers),
        },
        "payload": payload,
    }
    if payload_text is not None:
        entry["payloadText"] = payload_text

    log_file = LOG_FILES[event_name]
    append_log(log_file, entry)

    return {
        "ok": True,
        "eventName": event_name,
        "message": "Request body written to log file.",
        "logFile": str(log_file),
    }


@app.post("/llm_output")
async def llm_output(request: Request) -> dict:
    return await record_event(request, "llm_output")


@app.post("/agent_end")
async def agent_end(request: Request) -> dict:
    return await record_event(request, "agent_end")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
