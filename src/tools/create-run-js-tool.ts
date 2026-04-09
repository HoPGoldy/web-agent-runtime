import type { ToolInterface } from "./tool-interface";

/**
 * Input accepted by the demo JavaScript execution tool.
 */
interface RunJsToolInput {
  code: string;
}

/**
 * Options for creating the demo JavaScript execution tool.
 */
interface CreateRunJsToolOptions {
  globals?: Record<string, unknown>;
  onConsoleLog?: (...args: unknown[]) => void;
}

function stringifyLogArg(arg: unknown) {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function createExpressionExecutor(code: string) {
  return new Function("globals", "console", `return (${code});`) as (
    globals: Record<string, unknown>,
    console: { log: (...args: unknown[]) => void },
  ) => unknown;
}

function createScriptExecutor(code: string) {
  return new Function("globals", "console", code) as (
    globals: Record<string, unknown>,
    console: { log: (...args: unknown[]) => void },
  ) => unknown;
}

export function createRunJsTool(
  options: CreateRunJsToolOptions = {},
): ToolInterface<RunJsToolInput, unknown> {
  return {
    name: "runjs",
    description:
      "Execute JavaScript against the local demo runtime and inspect the result.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The JavaScript code to execute.",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
    async execute(_toolCallId, input) {
      const logs: string[] = [];
      const capturedConsole = {
        log: (...args: unknown[]) => {
          logs.push(args.map(stringifyLogArg).join(" "));
          options.onConsoleLog?.(...args);
        },
      };

      let executor: (
        globals: Record<string, unknown>,
        console: typeof capturedConsole,
      ) => unknown;

      try {
        executor = createExpressionExecutor(input.code);
      } catch {
        executor = createScriptExecutor(input.code);
      }

      const result = await executor(
        { ...(options.globals ?? {}) },
        capturedConsole,
      );
      return logs.length > 0 ? { result, logs } : result;
    },
  };
}
