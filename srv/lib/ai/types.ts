import { z } from 'zod';
// IAIProvider — pluggable interface for LLM providers.
// Implementations: AnthropicDirect, SapAiCore.
// Factory in index.ts selects via AgentConfig.active_ai_provider or AP_RECON_AI_PROVIDER.
export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AICompletionRequest {
  system: string;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface AICompletionResponse {
  content: string;          // Raw text response from the model
  model: string;            // Actual model ID used
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  stopReason: string;       // 'end_turn' | 'max_tokens' | etc.
}

export interface IAIProvider {
  readonly providerName: string;   // 'ANTHROPIC_DIRECT' | 'SAP_AI_CORE'
  readonly modelId: string;        // Provider-specific model identifier

  complete(request: AICompletionRequest): Promise<AICompletionResponse>;
  completeWithTools(request: AIToolCompletionRequest): Promise<AIToolCompletionResponse>;
}

// Zod schema for all LLM responses
// Every detector that calls the LLM must validate its response with Zod.
// Never trust raw LLM output as typed.

export const LlmFieldSwapResponseSchema = z.object({
  isSwap: z.boolean(),
  confidence: z.number().min(0).max(1),
  swappedFields: z.array(z.object({
    lineNumber: z.number(),
    field: z.string(),
    invoiceValue: z.number(),
    expectedValue: z.number(),
  })),
  explanation: z.string(),
  correctedLines: z.array(z.object({
    lineNumber: z.number(),
    correctedQty: z.number().optional(),
    correctedUnitPrice: z.number().optional(),
    correctedNetAmount: z.number().optional(),
  })),
});

export const LlmDiscrepancyResponseSchema = z.object({
  hasDiscrepancy: z.boolean(),
  discrepancyType: z.string(),
  confidence: z.number().min(0).max(1),
  riskTier: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  explanation: z.string(),
  suggestedAction: z.string(),
  detectedFields: z.array(z.object({
    field: z.string(),
    invoiceValue: z.union([z.string(), z.number()]),
    expectedValue: z.union([z.string(), z.number()]),
    poValue: z.union([z.string(), z.number()]).optional(),
  })).optional(),
});

export type LlmFieldSwapResponse = z.infer<typeof LlmFieldSwapResponseSchema>;
export type LlmDiscrepancyResponse = z.infer<typeof LlmDiscrepancyResponseSchema>;
// Tool-calling support (used by AssistantService)
/** Provider-agnostic tool definition. */
export interface AIToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

/** A single tool call returned by the model. */
export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Message types for tool-calling conversations. */
export type AIToolMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AIToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/** Request with tool definitions. */
export interface AIToolCompletionRequest {
  system: string;
  messages: AIToolMessage[];
  tools: AIToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

/** Response that may include tool calls. */
export interface AIToolCompletionResponse {
  content: string | null;
  toolCalls: AIToolCall[];
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  stopReason: string;
}
