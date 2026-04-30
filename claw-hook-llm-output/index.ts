/**
 * Claw Hook LLM Output Plugin
 *
 * Sends every llm_input and llm_output hook payload to the configured webhook URL.
 *
 * Example:
 *   openclaw config set plugins.entries.claw-hook-llm-output.config.hook_url "http://127.0.0.1:3100/llm_hook"
 *   openclaw config set plugins.entries.claw-hook-llm-output.config.bridge_token "<token>"
 *   openclaw gateway restart
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const PLUGIN_ID = "claw-hook-llm-output";
type ForwardedEventName = "llm_input" | "llm_output";
type PluginConfig = {
  bridge_token?: string;
  hook_url?: string;
};

function loadPluginConfig(api: OpenClawPluginApi): PluginConfig {
  try {
    const runtime = (api as any).runtime;
    const cfg = runtime?.config?.loadConfig?.() ?? {};
    return cfg?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
  } catch {
    return {};
  }
}

function trimValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function forwardHookEvent(params: {
  api: OpenClawPluginApi;
  eventName: ForwardedEventName;
  event: unknown;
  ctx: unknown;
}) {
  const { api, eventName, event, ctx } = params;
  const pluginCfg = loadPluginConfig(api);
  const hookUrl = trimValue(pluginCfg.hook_url);
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
    api.logger.info(`${PLUGIN_ID}: ${eventName} webhook call successful (${response.status})`);
  } else {
    api.logger.warn(`${PLUGIN_ID}: ${eventName} webhook call failed (${response.status})`);
  }
}

const clawHookLlmOutputPlugin = {
  id: PLUGIN_ID,
  name: "Claw Hook LLM Output",
  description: "Forwards llm_input and llm_output hook events to a webhook endpoint",

  register(api: OpenClawPluginApi) {
    api.logger.info(`${PLUGIN_ID}: plugin registered`);

    const registerForwarder = (eventName: ForwardedEventName) => api.on(eventName, async (event, ctx) => {
      try {
        await forwardHookEvent({ api, eventName, event, ctx });
      } catch (err) {
        api.logger.error(`${PLUGIN_ID}: ${eventName} webhook call error: ${String(err)}`);
      }
    });

    registerForwarder("llm_input");
    registerForwarder("llm_output");

    api.registerService({
      id: PLUGIN_ID,
      start: () => api.logger.info(`${PLUGIN_ID}: service started`),
      stop: () => api.logger.info(`${PLUGIN_ID}: service stopped`),
    });
  },
};

export default clawHookLlmOutputPlugin;
