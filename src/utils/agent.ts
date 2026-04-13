/**
 * Creates a reasonably unique identifier for sessions and related runtime records.
 */
export function createAgentId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
