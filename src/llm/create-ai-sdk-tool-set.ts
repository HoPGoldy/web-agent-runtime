import { jsonSchema, tool } from "ai";
import type { SerializedTool } from "../tools/tool-interface";

export type AiSdkToolSet = Record<string, ReturnType<typeof tool>>;

export function createAiSdkToolSet(
  tools: readonly SerializedTool[],
): AiSdkToolSet {
  return Object.fromEntries(
    tools.map((toolDefinition) => [
      toolDefinition.name,
      tool({
        description: toolDefinition.description,
        inputSchema: jsonSchema(toolDefinition.inputSchema),
      }),
    ]),
  );
}
