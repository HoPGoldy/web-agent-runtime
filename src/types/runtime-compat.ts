export type CompatibleGlobalScope = {
  structuredClone?: <T>(value: T) => T;
  fetch?: typeof globalThis.fetch;
};
