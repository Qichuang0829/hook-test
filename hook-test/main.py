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
    "llm_input": LOG_DIR / "llm_input.log",
    "llm_output": LOG_DIR / "llm_output.log",
    "agent_end": LOG_DIR / "agent_end.log",
    "before_tool_call": LOG_DIR / "before_tool_call.log",
    "after_tool_call": LOG_DIR / "after_tool_call.log",
    "tool_result_persist": LOG_DIR / "tool_result_persist.log",
    "new_claw_core_deduct_api": LOG_DIR / "new_claw_core_deduct_api.log",
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


def resolve_event_name(request: Request, default_event_name: str) -> str:
    header_event_name = request.headers.get("x-openclaw-hook-event")
    if header_event_name in LOG_FILES:
        return header_event_name

    return default_event_name


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


async def record_event(request: Request, event_name: str) -> dict:
    body = await request.body()
    if len(body) > MAX_BODY_SIZE:
        raise HTTPException(status_code=413, detail="Payload too large")

    resolved_event_name = resolve_event_name(request, event_name)
    raw_body = body.decode("utf-8", errors="replace")
    payload, payload_text = parse_payload(raw_body)
    entry = {
        "receivedAt": datetime.now(timezone.utc).isoformat(),
        "eventName": resolved_event_name,
        "request": {
            "method": request.method,
            "path": str(request.url.path),
            "headers": dict(request.headers),
        },
        "payload": payload,
    }
    if payload_text is not None:
        entry["payloadText"] = payload_text

    log_file = LOG_FILES[resolved_event_name]
    append_log(log_file, entry)

    return {
        "ok": True,
        "eventName": resolved_event_name,
        "message": "Request body written to log file.",
        "logFile": str(log_file),
    }


@app.post("/llm_output")
async def llm_output(request: Request) -> dict:
    return await record_event(request, "llm_output")


@app.post("/llm_input")
async def llm_input(request: Request) -> dict:
    return await record_event(request, "llm_input")


@app.post("/agent_end")
async def agent_end(request: Request) -> dict:
    return await record_event(request, "agent_end")


@app.post("/before_tool_call")
async def before_tool_call(request: Request) -> dict:
    return await record_event(request, "before_tool_call")


@app.post("/after_tool_call")
async def after_tool_call(request: Request) -> dict:
    return await record_event(request, "after_tool_call")


@app.post("/tool_result_persist")
async def tool_result_persist(request: Request) -> dict:
    return await record_event(request, "tool_result_persist")


@app.post("/new_claw_core_deduct_api")
async def new_claw_core_deduct_api(request: Request) -> dict:
    return await record_event(request, "new_claw_core_deduct_api")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
