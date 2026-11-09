import type { ModelTier, ProviderName } from '@grasp/schema';

/** What a provider can take besides text. */
export type FileKind = 'image' | 'pdf';

/**
 * A file sent to the model inline with a message — an image or PDF the learner
 * attached. Base64, because every provider's JSON API wants it that way.
 */
export interface InlineFile {
  mime: string;
  base64: string;
  name?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /**
   * Sent only to providers that declare they can read them (`reads`). The
   * gateway strips them for the rest — which is why an attachment's transcript
   * always travels in `content` too.
   */
  files?: InlineFile[];
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
  /** File kinds this provider's models accept inline. Absent ⇒ text only. */
  readonly reads?: readonly FileKind[];
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
