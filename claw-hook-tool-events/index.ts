/**
 * Claw Hook Tool Events Plugin
 *
 * Forwards before_tool_call, after_tool_call, and tool_result_persist hook
 * payloads to the configured webhook service.
 *
 * After installation, configure via:
 *   openclaw config set plugins.entries.claw-hook-tool-events.config.hook_url "http://127.0.0.1:3100"
 *   openclaw config set plugins.entries.claw-hook-tool-events.config.bridge_token "<token>"
 *   openclaw gateway restart
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const PLUGIN_ID = "claw-hook-tool-events";

type PluginConfig = {
  bridge_token?: string;
  hook_url?: string;
};

type ForwardedEventName = "before_tool_call" | "after_tool_call" | "tool_result_persist";

function loadPluginConfig(api: OpenClawPluginApi): PluginConfig {
  try {
    const runtime = (api as { runtime?: { config?: { loadConfig?: () => unknown } } }).runtime;
    const cfg =
      (runtime?.config?.loadConfig?.() as {
        plugins?: { entries?: Record<string, { config?: PluginConfig }> };
      } | null) ?? null;
    return cfg?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
  } catch {
    return {};
  }
}

function trimValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveHookUrl(config: PluginConfig, eventName: ForwardedEventName): string | undefined {
  const hookUrl = trimValue(config.hook_url);
  if (!hookUrl) {
    return undefined;
  }

  return `${hookUrl.replace(/\/+$/, "")}/${eventName}`;
}

async function forwardHookEvent(params: {
  api: OpenClawPluginApi;
  eventName: ForwardedEventName;
  event: unknown;
  ctx: unknown;
}) {
  const { api, eventName, event, ctx } = params;
  const pluginCfg = loadPluginConfig(api);
  const hookUrl = resolveHookUrl(pluginCfg, eventName);
  const bridgeToken = trimValue(pluginCfg.bridge_token);

  if (!hookUrl) {
    api.logger.warn(`${PLUGIN_ID}: hook_url not configured, skipping ${eventName}`);
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-openclaw-hook-event": eventName,
  };
  if (bridgeToken) {
    headers.bridge_token = bridgeToken;
  }

  const response = await fetch(hookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ event, ctx }),
  });

  if (response.ok) {
    api.logger.info(`${PLUGIN_ID}: ${eventName} forward successful (${response.status})`);
  } else {
    api.logger.warn(`${PLUGIN_ID}: ${eventName} forward failed (${response.status})`);
  }
}

function enqueueForward(params: {
  api: OpenClawPluginApi;
  eventName: ForwardedEventName;
  event: unknown;
  ctx: unknown;
}) {
  const { api, eventName } = params;
  void forwardHookEvent(params).catch((err) => {
    api.logger.error(`${PLUGIN_ID}: ${eventName} forward error: ${String(err)}`);
  });
}

const clawHookToolEventsPlugin = {
  id: PLUGIN_ID,
  name: "Claw Hook Tool Events",
  description: "Forwards before_tool_call, after_tool_call, and tool_result_persist hook events",
  kind: "utility" as const,

  register(api: OpenClawPluginApi) {
    api.logger.info(`${PLUGIN_ID}: plugin registered`);

    api.on("before_tool_call", (event, ctx) => {
      // Avoid slowing tool execution on network I/O.
      enqueueForward({
        api,
        eventName: "before_tool_call",
        event,
        ctx,
      });

      return undefined;
    });

    api.on("after_tool_call", (event, ctx) => {
      enqueueForward({
        api,
        eventName: "after_tool_call",
        event,
        ctx,
      });
    });

    api.on("tool_result_persist", (event, ctx) => {
      // This hook is synchronous in OpenClaw, so forwarding stays fire-and-forget.
      enqueueForward({
        api,
        eventName: "tool_result_persist",
        event,
        ctx,
      });

      return undefined;
    });

    api.registerService({
      id: PLUGIN_ID,
      start: () => api.logger.info(`${PLUGIN_ID}: service started`),
      stop: () => api.logger.info(`${PLUGIN_ID}: service stopped`),
    });
  },
};

export default clawHookToolEventsPlugin;
