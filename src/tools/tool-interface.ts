import type { UIMessage } from "ai";
import type { AgentSession } from "../types";

/**
 * Context passed to a high-level Agent tool implementation.
 */
export interface ToolExecutionContext<
  UI_MESSAGE extends UIMessage = UIMessage,
> {
  session: AgentSession | null;
  messages: UI_MESSAGE[];
}

/**
 * Tool contract used by the high-level Agent wrapper.
 */
export interface ToolInterface<
  INPUT = unknown,
  OUTPUT = unknown,
  UI_MESSAGE extends UIMessage = UIMessage,
> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(
    toolCallId: string,
    input: INPUT,
    context: ToolExecutionContext<UI_MESSAGE>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void,
  ): Promise<OUTPUT>;
}

/**
 * Serializable shape of a tool definition.
 */
export interface SerializedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function serializeTool(tool: ToolInterface): SerializedTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}
