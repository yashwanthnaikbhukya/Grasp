import type { ModelTier, ProviderName } from '@grasp/schema';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  tier: ModelTier;
  system?: string;
  messages: ChatMessage[];
  /** JSON Schema object. Present ⇒ the provider must constrain output to it. */
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens: number;
  /** Providers that expose a reasoning budget; ignored by those that do not. */
  reasoningEffort?: 'low' | 'medium' | 'high';
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  text: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  };
}

/**
 * A provider adapter. Adding a provider means adding one of these and one line
 * in `chainFor()` — nothing else in the codebase changes.
 */
export interface ProviderAdapter {
  readonly name: ProviderName;
  /** Usable given the keys actually present in the environment. */
  available(tier: ModelTier): boolean;
  /** Concrete model this adapter will use for a tier — for tracing. */
  modelFor(tier: ModelTier): string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export interface EmbedRequest {
  texts: string[];
  purpose: 'chunk' | 'query';
}

export interface EmbedResponse {
  vectors: number[][];
  model: string;
  dim: number;
}
