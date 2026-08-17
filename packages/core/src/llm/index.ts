export { generateStream } from './stream';
export type { StreamArgs, StreamChunk } from './stream';
export { generate, embed, chainFor } from './gateway';
export type { GenerateArgs, GenerateResult } from './gateway';
export { TASKS, taskConfig, listTasks } from './registry';
export type { TaskId, TaskConfig } from './registry';
export { trace, newTraceId } from './trace';
export type { TraceRecord } from './trace';
export { ollamaStatus } from './providers/ollama';
export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ProviderAdapter,
} from './types';
