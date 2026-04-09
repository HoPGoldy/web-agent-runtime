export type {
  AssistantStreamEvent,
  LlmContext,
  LlmProvider,
  LlmStreamRequest,
  LlmToolDefinition,
  ResultStream,
} from "../providers";

/**
 * Creates an in-memory result stream from a fixed event list and final value.
 * Useful for tests, mock providers, and adapters that already materialized all events.
 */
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
