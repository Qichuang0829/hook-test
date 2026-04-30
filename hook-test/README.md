# hook-test

一个用于本地调试 OpenClaw hook 的轻量 FastAPI webhook 接收服务。
它会接收 hook 请求，并按事件类型把原始请求追加写入 `./logs` 目录下的对应日志文件。

## 依赖

安装依赖：

```powershell
pip install -r requirements.txt
```

当前依赖：

- `fastapi`
- `uvicorn`

## 启动

默认监听：

- `HOST=0.0.0.0`
- `PORT=3100`

启动服务：

```powershell
python .\main.py
```

如需覆盖地址或端口：

```powershell
$env:HOST="127.0.0.1"
$env:PORT="3100"
python .\main.py
```

## 路由

- `GET /health`
- `POST /llm_input`
- `POST /llm_output`
- `POST /agent_end`
- `POST /before_tool_call`
- `POST /after_tool_call`
- `POST /tool_result_persist`
- `POST /new_claw_core_deduct_api`

## 日志文件

日志写入 `./logs` 目录：

- `logs/llm_input.log`
- `logs/llm_output.log`
- `logs/agent_end.log`
- `logs/before_tool_call.log`
- `logs/after_tool_call.log`
- `logs/tool_result_persist.log`
- `logs/new_claw_core_deduct_api.log`

每次请求会追加一行 JSON，常见字段包括：

- `receivedAt`
- `eventName`
- `request`
- `payload`
- `payloadText`

其中 `payloadText` 仅在请求体不是合法 JSON 时写入。

## 事件分流规则

这个服务会优先读取请求头 `x-openclaw-hook-event`，再决定把请求写入哪个日志文件。

例如：

- 请求路径是 `/llm_output`，但请求头是 `x-openclaw-hook-event: llm_input`
  - 会写入 `logs/llm_input.log`
- 请求路径是 `/after_tool_call`，请求头是 `x-openclaw-hook-event: before_tool_call`
  - 会写入 `logs/before_tool_call.log`
- 如果没有这个请求头
  - 才回退到当前路由对应的默认事件名

## claw-hook-tool-events 接口

给 `claw-hook-tool-events` 插件预留的接收接口是：

- `POST /before_tool_call`
- `POST /after_tool_call`
- `POST /tool_result_persist`

如果插件配置为：

```powershell
openclaw config set plugins.entries.claw-hook-tool-events.config.hook_url "http://127.0.0.1:3100"
openclaw config set plugins.entries.claw-hook-tool-events.config.bridge_token "<token>"
openclaw gateway restart
```

那么插件会分别把三个工具 hook 事件发到：

- `http://127.0.0.1:3100/before_tool_call`
- `http://127.0.0.1:3100/after_tool_call`
- `http://127.0.0.1:3100/tool_result_persist`

请求体结构统一是：

```json
{
  "event": {},
  "ctx": {}
}
```

## new-claw-core-deduct-api 接口

给 `new-claw-core-deduct-api` 插件预留的接收接口是：

```text
POST /new_claw_core_deduct_api
```

对应日志文件：

```text
logs/new_claw_core_deduct_api.log
```

如果你把插件配置成：

```powershell
openclaw config set plugins.entries.new-claw-core-deduct-api.config.deduct_api_url "http://127.0.0.1:3100/new_claw_core_deduct_api"
openclaw gateway restart
```

那么这个接口会收到类似下面的请求体：

```json
{
  "llm_input": {
    "runId": "...",
    "sessionId": "...",
    "provider": "...",
    "model": "...",
    "prompt": "..."
  },
  "llm_output": {
    "event": {},
    "ctx": {}
  }
}
```

## 单一 hook_url 示例

如果你的 `claw-hook-llm-output` 插件只配置了一个地址：

```powershell
openclaw config set plugins.entries.claw-hook-llm-output.config.hook_url "http://127.0.0.1:3100/llm_output"
openclaw gateway restart
```

那么两个事件都可能打到 `/llm_output`，但仍会通过请求头区分：

- `x-openclaw-hook-event: llm_input`
- `x-openclaw-hook-event: llm_output`

`hook-test` 会据此自动写入正确的日志文件。

## 成功返回示例

```json
{
  "ok": true,
  "eventName": "before_tool_call",
  "message": "Request body written to log file.",
  "logFile": "D:\\code\\hook-test\\logs\\before_tool_call.log"
}
```

## 注意事项

- 单次请求体大小上限是 `5 MB`
- `main.py` 当前以 `reload=False` 启动 `uvicorn`
- 修改代码后需要手动重启服务
