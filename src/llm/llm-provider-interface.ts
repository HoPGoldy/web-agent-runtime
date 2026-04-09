export type {
  AssistantStreamEvent,
  LlmContext,
  LlmProvider,
  LlmStreamRequest,
  LlmToolDefinition,
  ResultStream,
} from "../providers";

export function createResultStream<TEvent, TResult>(
  events: TEvent[],
  result: TResult,
): AsyncIterable<TEvent> & { result(): Promise<TResult> } {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    async result() {
      return result;
    },
  };
}