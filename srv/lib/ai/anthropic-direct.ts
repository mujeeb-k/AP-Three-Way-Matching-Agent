import Anthropic from '@anthropic-ai/sdk';
import type { IAIProvider, AICompletionRequest, AICompletionResponse, AIToolCompletionRequest, AIToolCompletionResponse, AIToolMessage, AIToolCall } from './types.js';
import { AIProviderError } from '../util/errors.js';
import { childLogger } from '../util/logger.js';

const log = childLogger('ai:anthropic');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicDirectProvider implements IAIProvider {
  readonly providerName = 'ANTHROPIC_DIRECT';
  readonly modelId: string;

  private readonly client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AIProviderError('ANTHROPIC_API_KEY env var is required');

    this.modelId = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.client = new Anthropic({ apiKey });
    log.info({ model: this.modelId }, 'Anthropic provider initialized');
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    log.debug({ messageCount: request.messages.length }, 'Sending completion request');

    try {
      const response = await this.client.messages.create({
        model: this.modelId,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature ?? 0,  // deterministic for financial reasoning
        system: request.system,
        messages: request.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      });

      const content = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { type: 'text'; text: string }).text)
        .join('');

      log.debug({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
      }, 'Completion received');

      return {
        content,
        model: response.model,
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        stopReason: response.stop_reason ?? 'end_turn',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Anthropic API error');
      throw new AIProviderError(`Anthropic API call failed: ${message}`, { model: this.modelId });
    }
  }

  async completeWithTools(request: AIToolCompletionRequest): Promise<AIToolCompletionResponse> {
    log.debug({ messageCount: request.messages.length, toolCount: request.tools.length }, 'Sending tool completion request');

    try {
      const tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool.InputSchema,
      }));

      const messages = this.convertToolMessages(request.messages);

      const response = await this.client.messages.create({
        model: this.modelId,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature ?? 0,
        system: request.system,
        tools,
        messages,
      });

      let textContent = '';
      const toolCalls: AIToolCall[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      log.debug({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
        toolCallCount: toolCalls.length,
      }, 'Tool completion received');

      return {
        content: textContent || null,
        toolCalls,
        model: response.model,
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        stopReason: response.stop_reason ?? 'end_turn',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Anthropic API error (tool completion)');
      throw new AIProviderError(`Anthropic API call failed: ${message}`, { model: this.modelId });
    }
  }

  /** Convert provider-agnostic tool messages to Anthropic message format. */
  private convertToolMessages(messages: AIToolMessage[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    // Group consecutive tool-result messages into a single user message
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
          }
        }
        result.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        // Anthropic expects tool results as user messages with tool_result content blocks.
        // Collect consecutive tool messages into one user message.
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        let j = i;
        while (j < messages.length && messages[j].role === 'tool') {
          const tm = messages[j] as { role: 'tool'; toolCallId: string; content: string };
          toolResults.push({ type: 'tool_result', tool_use_id: tm.toolCallId, content: tm.content });
          j++;
        }
        result.push({ role: 'user', content: toolResults });
        i = j - 1; // advance past grouped tool messages
      }
    }

    return result;
  }
}
