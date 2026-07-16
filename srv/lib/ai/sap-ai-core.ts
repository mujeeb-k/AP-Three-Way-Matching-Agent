import { OrchestrationClient } from '@sap-ai-sdk/orchestration';
import type { LlmModelParams, ChatMessage as SdkChatMessage, ChatCompletionTool } from '@sap-ai-sdk/orchestration';
import type { IAIProvider, AICompletionRequest, AICompletionResponse, AIToolCompletionRequest, AIToolCompletionResponse, AIToolMessage, AIToolCall } from './types.js';
import { AIProviderError } from '../util/errors.js';
import { childLogger } from '../util/logger.js';

const log = childLogger('ai:sap-ai-core');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

/**
 * SAP AI Core provider via @sap-ai-sdk/orchestration.
 * Reads credentials from VCAP_SERVICES (BTP) or AICORE_SERVICE_KEY env var.
 * This is the production path — data stays in EU/BTP region.
 */
export class SapAiCoreProvider implements IAIProvider {
  readonly providerName = 'SAP_AI_CORE';
  readonly modelId: string;

  constructor() {
    this.modelId = process.env.SAP_AI_MODEL ?? DEFAULT_MODEL;
    log.info({ model: this.modelId }, 'SAP AI Core provider initialized');
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    log.debug({ messageCount: request.messages.length }, 'Sending completion request');

    const modelParams: LlmModelParams = {
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature ?? 0,
    };

    const client = new OrchestrationClient({
      promptTemplating: {
        model: {
          name: this.modelId as any,
          params: modelParams,
        },
        // System message injected via messages below
      },
    });

    try {
      // Build message array: system first, then conversation history
      const allMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: request.system },
        ...request.messages.map(m => ({ role: m.role, content: m.content })),
      ];

      const response = await client.chatCompletion({
        messages: allMessages,
      });

      const content = response.getContent() ?? '';
      const usage = response.getTokenUsage();

      log.debug({
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
      }, 'Completion received');

      return {
        content,
        model: this.modelId,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
        stopReason: response.getFinishReason() ?? 'end_turn',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'SAP AI Core error');
      throw new AIProviderError(`SAP AI Core call failed: ${message}`, { model: this.modelId });
    }
  }

  async completeWithTools(request: AIToolCompletionRequest): Promise<AIToolCompletionResponse> {
    log.debug({ messageCount: request.messages.length, toolCount: request.tools.length }, 'Sending tool completion request');

    const modelParams: LlmModelParams = {
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature ?? 0,
    };

    const tools: ChatCompletionTool[] = request.tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const client = new OrchestrationClient({
      promptTemplating: {
        model: { name: this.modelId as any, params: modelParams },
        prompt: {
          template: [{ role: 'system', content: request.system }],
          tools,
        },
      },
    });

    try {
      // Convert our messages to SDK format
      const messagesHistory: SdkChatMessage[] = this.convertToolMessages(request.messages);

      const response = await client.chatCompletion({ messagesHistory });

      const textContent = response.getContent() ?? '';
      const sdkToolCalls = response.getToolCalls();
      const toolCalls: AIToolCall[] = [];

      if (sdkToolCalls) {
        for (const tc of sdkToolCalls) {
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          });
        }
      }

      const usage = response.getTokenUsage();

      log.debug({
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        toolCallCount: toolCalls.length,
      }, 'Tool completion received');

      return {
        content: textContent || null,
        toolCalls,
        model: this.modelId,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
        stopReason: toolCalls.length > 0 ? 'tool_use' : (response.getFinishReason() ?? 'end_turn'),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'SAP AI Core error (tool completion)');
      throw new AIProviderError(`SAP AI Core call failed: ${message}`, { model: this.modelId });
    }
  }

  /** Convert provider-agnostic tool messages to SAP SDK ChatMessage format. */
  private convertToolMessages(messages: AIToolMessage[]): SdkChatMessage[] {
    const result: SdkChatMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const assistantMsg: any = { role: 'assistant', content: msg.content || '' };
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        result.push(assistantMsg);
      } else if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        });
      }
    }

    return result;
  }
}
