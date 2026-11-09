export { generateStream } from './stream';
export type { StreamArgs, StreamChunk } from './stream';
export { generate, embed, chainFor, fileKind } from './gateway';
export type { GenerateArgs, GenerateResult } from './gateway';
export { TASKS, taskConfig, listTasks } from './registry';
export type { TaskId, TaskConfig } from './registry';
export { trace, newTraceId } from './trace';
export { tierForLearner, tierWithinBudget, outputTokensToday } from './budget';
export type { TraceRecord } from './trace';
export { ollamaStatus } from './providers/ollama';
export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  FileKind,
  InlineFile,
  ProviderAdapter,
} from './types';
