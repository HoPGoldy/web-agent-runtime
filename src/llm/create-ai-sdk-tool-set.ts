import { jsonSchema, tool } from "ai";
import type { LlmToolDefinition } from "../providers";

/**
 * Tool dictionary compatible with the AI SDK `tool` helper.
 */
export type AiSdkToolSet = Record<string, ReturnType<typeof tool>>;

export function createAiSdkToolSet(tools: readonly LlmToolDefinition[]): AiSdkToolSet {
  return Object.fromEntries(
/**
 * Converts serialized runtime tool definitions into the AI SDK `tool` dictionary format.
 */
    tools.map((toolDefinition) => [
      toolDefinition.name,
      tool({
        description: toolDefinition.description,
        inputSchema: jsonSchema(toolDefinition.inputSchema),
      }),
    ]),
  );
}
