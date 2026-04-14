import type { CompatibleGlobalScope } from "../types/runtime-compat";

function getCompatibleGlobalScope(): CompatibleGlobalScope | undefined {
  if (typeof globalThis !== "undefined") {
    return globalThis;
  }

  if (typeof self !== "undefined") {
    return self;
  }

  if (typeof window !== "undefined") {
    return window;
  }

  return undefined;
}

export function cloneSerializableValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function resolveFetchImplementation(
  fetchImpl?: typeof globalThis.fetch,
): typeof globalThis.fetch {
  if (fetchImpl) {
    return fetchImpl;
  }

  const globalScope = getCompatibleGlobalScope();
  if (typeof globalScope?.fetch === "function") {
    return globalScope.fetch.bind(globalScope) as typeof globalThis.fetch;
  }

  throw new Error(
    "No fetch implementation is available. Pass fetch explicitly in this environment.",
  );
}
