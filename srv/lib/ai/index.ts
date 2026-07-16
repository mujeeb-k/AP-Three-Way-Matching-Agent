import cds from '@sap/cds';
import type { IAIProvider, AIToolCompletionRequest, AIToolCompletionResponse } from './types.js';
import { MockAIProvider } from './mock.js';
import { AIProviderError } from '../util/errors.js';
import { childLogger } from '../util/logger.js';

const log = childLogger('ai:factory');

let _instance: IAIProvider | null = null;
let _fallback: IAIProvider | null = null;

type AIProviderType = 'MOCK' | 'ANTHROPIC_DIRECT' | 'SAP_AI_CORE';

/**
 * Returns the active AI provider singleton.
 * Resolution order:
 *   1. AP_RECON_AI_PROVIDER env var
 *   2. AgentConfig DB row with key 'active_ai_provider'
 *   3. Default: MOCK (no API key required)
 *
 * If AI_FALLBACK_ENABLED=true and primary provider fails,
 * falls back to MOCK automatically.
 */
export async function getAIProvider(): Promise<IAIProvider> {
  if (_instance) return _instance;

  const providerType = await resolveProviderType();
  log.info({ providerType }, 'Initializing AI provider');

  _instance = await buildProviderAsync(providerType);

  // Warm up fallback if enabled and primary is not MOCK
  if (process.env.AI_FALLBACK_ENABLED === 'true' && providerType !== 'MOCK') {
    try {
      _fallback = new MockAIProvider();
    } catch {
      log.warn('Fallback provider (MOCK) could not be initialized — fallback disabled');
    }
  }

  return _instance;
}

/**
 * Wraps getAIProvider with fallback logic.
 * Use this in the pipeline instead of getAIProvider() directly.
 */
export async function completeWithFallback(
  request: Parameters<IAIProvider['complete']>[0]
): Promise<ReturnType<IAIProvider['complete']>> {
  const primary = await getAIProvider();
  try {
    return await primary.complete(request);
  } catch (err) {
    if (_fallback) {
      log.warn({ err }, 'Primary AI provider failed — trying fallback');
      return _fallback.complete(request);
    }
    throw err;
  }
}

/**
 * Wraps getAIProvider with fallback logic for tool-calling requests.
 * Used by AssistantService for chat with function calling.
 */
export async function completeWithToolsFallback(
  request: AIToolCompletionRequest
): Promise<AIToolCompletionResponse> {
  const primary = await getAIProvider();
  try {
    return await primary.completeWithTools(request);
  } catch (err) {
    if (_fallback) {
      log.warn({ err }, 'Primary AI provider failed (tool completion) — trying fallback');
      return _fallback.completeWithTools(request);
    }
    throw err;
  }
}

/** Force re-init — called by EvalService.switchAIProvider(). */
export function resetAIProvider(): void {
  _instance = null;
  _fallback = null;
}

async function buildProviderAsync(type: AIProviderType): Promise<IAIProvider> {
  switch (type) {
    case 'MOCK':
      return new MockAIProvider();
    case 'ANTHROPIC_DIRECT': {
      const { AnthropicDirectProvider } = await import('./anthropic-direct.js');
      return new AnthropicDirectProvider();
    }
    case 'SAP_AI_CORE': {
      const { SapAiCoreProvider } = await import('./sap-ai-core.js');
      return new SapAiCoreProvider();
    }
    default:
      throw new AIProviderError(`Unknown AI provider type: ${type}`);
  }
}

async function resolveProviderType(): Promise<AIProviderType> {
  // 1. Env var override
  const envVal = process.env.AP_RECON_AI_PROVIDER as AIProviderType | undefined;
  if (envVal) return envVal;

  // 2. DB config
  try {
    const db = await cds.connect.to('db');
    const row = await db.run(
      SELECT.one.from('ir.AgentConfig').where({ configKey: 'active_ai_provider' })
    );
    if (row?.configValue) return row.configValue as AIProviderType;
  } catch {
    log.warn('Could not read active_ai_provider from DB — falling back to MOCK');
  }

  return 'MOCK';
}
