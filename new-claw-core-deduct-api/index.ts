/**
 * New Claw Core Deduct API Plugin
 *
 * Waits for matching llm_input and llm_output events by runId, then calls
 * the resource deduction API once both sides are available.
 *
 * After installation, configure via:
 *   openclaw config set plugins.entries.new-claw-core-deduct-api.config.bridge_token "<token>"
 *   openclaw config set plugins.entries.new-claw-core-deduct-api.config.deduct_api_url "<url>"
 *   openclaw gateway restart
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const PLUGIN_ID = "new-claw-core-deduct-api";
const STALE_PAIR_TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

type PluginConfig = {
  bridge_token?: string;
  deduct_api_url?: string;
};

type LlmInputEvent = {
  runId?: string;
  sessionId?: string;
  provider?: string;
  model?: string;
  prompt?: string;
};

type SanitizedLlmInputEvent = {
  runId?: string;
  sessionId?: string;
  provider?: string;
  model?: string;
  prompt?: string;
};

type LlmOutputEvent = {
  runId?: string;
};

type PendingPair = {
  createdAt: number;
  llmInput?: SanitizedLlmInputEvent;
  llmOutput?: {
    event: unknown;
    ctx: unknown;
  };
};

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

function getRunId(event: unknown): string | undefined {
  const runId = (event as { runId?: unknown } | null | undefined)?.runId;
  return typeof runId === "string" && runId.trim() ? runId : undefined;
}

function sanitizeLlmInputEvent(event: LlmInputEvent): SanitizedLlmInputEvent {
  return {
    runId: event.runId,
    sessionId: event.sessionId,
    provider: event.provider,
    model: event.model,
    prompt: event.prompt,
  };
}

async function forwardMatchedPair(params: {
  api: OpenClawPluginApi;
  runId: string;
  pair: PendingPair;
}) {
  const { api, runId, pair } = params;
  const pluginCfg = loadPluginConfig(api);
  const bridgeToken = trimValue(pluginCfg.bridge_token);
  const deductUrl = trimValue(pluginCfg.deduct_api_url);

  if (!bridgeToken || !deductUrl) {
    api.logger.warn(`${PLUGIN_ID}: bridge_token or deduct_api_url not configured, skipping runId=${runId}`);
    return;
  }

  const response = await fetch(deductUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      bridge_token: bridgeToken,
    },
    body: JSON.stringify({
      llm_input: pair.llmInput,
      llm_output: pair.llmOutput,
    }),
  });

  if (response.ok) {
    api.logger.info(`${PLUGIN_ID}: matched API call successful for runId=${runId} (${response.status})`);
  } else {
    api.logger.warn(`${PLUGIN_ID}: matched API call failed for runId=${runId} (${response.status})`);
  }
}

function cleanupStalePairs(api: OpenClawPluginApi, pendingPairs: Map<string, PendingPair>) {
  const now = Date.now();
  for (const [runId, pair] of pendingPairs.entries()) {
    if (now - pair.createdAt < STALE_PAIR_TTL_MS) {
      continue;
    }

    pendingPairs.delete(runId);
    api.logger.warn(`${PLUGIN_ID}: discarded stale unmatched pair for runId=${runId}`);
  }
}

const newClawCoreDeductApiPlugin = {
  id: PLUGIN_ID,
  name: "New Claw Core Deduct API",
  description: "Calls resource deduction API after matching llm_input and llm_output by runId",
  kind: "utility" as const,

  register(api: OpenClawPluginApi) {
    api.logger.info(`${PLUGIN_ID}: plugin registered`);

    const pendingPairs = new Map<string, PendingPair>();
    let cleanupTimer: ReturnType<typeof setInterval> | undefined;

    const startCleanupTimer = () => {
      if (cleanupTimer) {
        return;
      }

      cleanupTimer = setInterval(() => {
        cleanupStalePairs(api, pendingPairs);
      }, CLEANUP_INTERVAL_MS);
    };

    const stopCleanupTimer = () => {
      if (!cleanupTimer) {
        return;
      }

      clearInterval(cleanupTimer);
      cleanupTimer = undefined;
    };

    const maybeForwardPair = async (runId: string) => {
      const pair = pendingPairs.get(runId);
      if (!pair?.llmOutput) {
        return;
      }

      try {
        await forwardMatchedPair({ api, runId, pair });
      } catch (err) {
        api.logger.error(`${PLUGIN_ID}: matched API call error for runId=${runId}: ${String(err)}`);
      } finally {
        pendingPairs.delete(runId);
      }
    };

    api.on("llm_input", async (event, ctx) => {
      const runId = getRunId(event);
      if (!runId) {
        api.logger.warn(`${PLUGIN_ID}: llm_input missing runId, skipping`);
        return;
      }

      const pair = pendingPairs.get(runId) ?? { createdAt: Date.now() };
      pair.llmInput = sanitizeLlmInputEvent(event as LlmInputEvent);
      pendingPairs.set(runId, pair);

      await maybeForwardPair(runId);
    });

    api.on("llm_output", async (event, ctx) => {
      const runId = getRunId(event);
      if (!runId) {
        api.logger.warn(`${PLUGIN_ID}: llm_output missing runId, skipping`);
        return;
      }

      const pair = pendingPairs.get(runId) ?? { createdAt: Date.now() };
      pair.llmOutput = {
        event: event as LlmOutputEvent,
        ctx,
      };
      pendingPairs.set(runId, pair);

      await maybeForwardPair(runId);
    });

    api.registerService({
      id: PLUGIN_ID,
      start: () => {
        startCleanupTimer();
        api.logger.info(`${PLUGIN_ID}: service started`);
      },
      stop: () => {
        stopCleanupTimer();
        pendingPairs.clear();
        api.logger.info(`${PLUGIN_ID}: service stopped`);
      },
    });
  },
};

export default newClawCoreDeductApiPlugin;
