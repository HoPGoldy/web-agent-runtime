import type { LoggerOptions, RuntimeLogger } from "../types/runtime";

export type { LoggerCallback, LoggerOptions, RuntimeLogger } from "../types/runtime";

/**
 * Verbosity levels understood by the runtime logger.
 */
export enum LogLevel {
  Error = 0,
  Warning = 1,
  Info = 2,
  Verbose = 3,
}

export function createRuntimeLogger(options?: LoggerOptions): RuntimeLogger | undefined {
  if (!options?.loggerCallback) {
    return undefined;
  }

  return {
    logLevel: options.logLevel ?? LogLevel.Verbose,
    loggerCallback: options.loggerCallback,
  };
}

export function traceRuntimeDebug(logger: RuntimeLogger | undefined, stage: string, data?: unknown) {
  logRuntime(logger, LogLevel.Verbose, stage, data);
}

export function traceRuntimeInfo(logger: RuntimeLogger | undefined, stage: string, data?: unknown) {
  logRuntime(logger, LogLevel.Info, stage, data);
}

export function traceRuntimeWarning(logger: RuntimeLogger | undefined, stage: string, data?: unknown) {
  logRuntime(logger, LogLevel.Warning, stage, data);
}

export function traceRuntimeError(logger: RuntimeLogger | undefined, stage: string, data?: unknown) {
  logRuntime(logger, LogLevel.Error, stage, data);
}

function logRuntime(logger: RuntimeLogger | undefined, level: LogLevel, stage: string, data?: unknown) {
  if (!logger || level > logger.logLevel) {
    return;
  }

  try {
    logger.loggerCallback(level, formatLogMessage(stage, data));
  } catch {
    // Ignore logger callback failures.
  }
}

function formatLogMessage(stage: string, data?: unknown) {
  const serializedData = serializeLogData(data);
  return serializedData ? `${stage} ${serializedData}` : stage;
}

function serializeLogData(data: unknown) {
  if (data === undefined) {
    return "";
  }

  if (typeof data === "string") {
    return data;
  }

  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}