/**
 * Claw Hook Event Bridge Plugin
 *
 * Forwards llm_output and agent_end hook payloads to configured webhook endpoints.
 *
 * After installation, configure via:
 *   openclaw config set plugins.entries.claw-hook-event-bridge.config.bridge_token "<token>"
 *   openclaw config set plugins.entries.claw-hook-event-bridge.config.hook_url "http://127.0.0.1:3100"
 *   openclaw gateway restart
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const PLUGIN_ID = "claw-hook-event-bridge";

type PluginConfig = {
  bridge_token?: string;
  hook_url?: string;
};

type ForwardedEventName = "llm_output" | "agent_end";

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

function trimUrl(url: string | undefined): string | undefined {
  const value = url?.trim();
  return value ? value : undefined;
}

function resolveHookUrl(config: PluginConfig, eventName: ForwardedEventName): string | undefined {
  const hookUrl = trimUrl(config.hook_url);
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
  const bridgeToken = trimUrl(pluginCfg.bridge_token);

  if (!bridgeToken || !hookUrl) {
    api.logger.warn(`${PLUGIN_ID}: bridge_token or ${eventName} hook URL not configured, skipping`);
    return;
  }

  const response = await fetch(hookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      bridge_token: bridgeToken,
    },
    body: JSON.stringify({ event, ctx }),
  });

  if (response.ok) {
    api.logger.info(`${PLUGIN_ID}: ${eventName} forward successful (${response.status})`);
  } else {
    api.logger.warn(`${PLUGIN_ID}: ${eventName} forward failed (${response.status})`);
  }
}

const clawHookEventBridgePlugin = {
  id: PLUGIN_ID,
  name: "Claw Hook Event Bridge",
  description: "Forwards llm_output and agent_end hook events to webhook endpoints",
  kind: "utility" as const,

  register(api: OpenClawPluginApi) {
    api.logger.info(`${PLUGIN_ID}: plugin registered`);

    api.on("llm_output", async (event, ctx) => {
      try {
        await forwardHookEvent({
          api,
          eventName: "llm_output",
          event,
          ctx,
        });
      } catch (err) {
        api.logger.error(`${PLUGIN_ID}: llm_output forward error: ${String(err)}`);
      }
    });

    api.on("agent_end", async (event, ctx) => {
      try {
        await forwardHookEvent({
          api,
          eventName: "agent_end",
          event,
          ctx,
        });
      } catch (err) {
        api.logger.error(`${PLUGIN_ID}: agent_end forward error: ${String(err)}`);
      }
    });

    api.registerService({
      id: PLUGIN_ID,
      start: () => api.logger.info(`${PLUGIN_ID}: service started`),
      stop: () => api.logger.info(`${PLUGIN_ID}: service stopped`),
    });
  },
};

export default clawHookEventBridgePlugin;
