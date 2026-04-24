/**
 * Claw Hook LLM Output Plugin
 *
 * Sends every llm_output hook payload to the configured webhook URL.
 *
 * Example:
 *   openclaw config set plugins.entries.claw-hook-llm-output.config.hook_url "http://127.0.0.1:3100/llm_output"
 *   openclaw config set plugins.entries.claw-hook-llm-output.config.bridge_token "<token>"
 *   openclaw gateway restart
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const PLUGIN_ID = "claw-hook-llm-output";

function loadPluginConfig(api: OpenClawPluginApi): { bridge_token?: string; hook_url?: string } {
  try {
    const runtime = (api as any).runtime;
    const cfg = runtime?.config?.loadConfig?.() ?? {};
    return cfg?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
  } catch {
    return {};
  }
}

const clawHookLlmOutputPlugin = {
  id: PLUGIN_ID,
  name: "Claw Hook LLM Output",
  description: "Forwards llm_output hook events to a webhook endpoint",

  register(api: OpenClawPluginApi) {
    api.logger.info(`${PLUGIN_ID}: plugin registered`);

    api.on("llm_output", async (event, ctx) => {
      try {
        const pluginCfg = loadPluginConfig(api);
        const hookUrl = pluginCfg.hook_url;
        const bridgeToken = pluginCfg.bridge_token;

        if (!hookUrl) {
          api.logger.warn(`${PLUGIN_ID}: hook_url not configured, skipping`);
          return;
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
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
          api.logger.info(`${PLUGIN_ID}: webhook call successful (${response.status})`);
        } else {
          api.logger.warn(`${PLUGIN_ID}: webhook call failed (${response.status})`);
        }
      } catch (err) {
        api.logger.error(`${PLUGIN_ID}: webhook call error: ${String(err)}`);
      }
    });

    api.registerService({
      id: PLUGIN_ID,
      start: () => api.logger.info(`${PLUGIN_ID}: service started`),
      stop: () => api.logger.info(`${PLUGIN_ID}: service stopped`),
    });
  },
};

export default clawHookLlmOutputPlugin;
