import type { ResultStream } from "../types/provider";

/**
 * Creates an in-memory result stream from a fixed event list and final value.
 * Useful for tests, mock providers, and adapters that already materialized all events.
 */
export function createResultStream<TEvent, TResult>(
  events: TEvent[],
  result: TResult,
): ResultStream<TEvent, TResult> {
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