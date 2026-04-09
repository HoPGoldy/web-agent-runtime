import type { LocalStorageFileStore } from "../local-storage-file-store";
import type { ToolInterface } from "./tool-interface";

/**
 * Input accepted by the demo read tool.
 */
interface ReadToolInput {
  key: string;
}

/**
 * Options for creating the demo read tool.
 */
interface CreateReadToolOptions {
  fileStore: LocalStorageFileStore;
}

export function createReadTool(
  options: CreateReadToolOptions,
): ToolInterface<
  ReadToolInput,
  { key: string; exists: boolean; content?: string }
> {
  return {
    name: "read",
    description: "Read a file from the local demo workspace by key.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The file key to read." },
      },
      required: ["key"],
      additionalProperties: false,
    },
    async execute(_toolCallId, input) {
      return options.fileStore.read(input.key);
    },
  };
}
