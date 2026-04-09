import type { LocalStorageFileStore } from "../local-storage-file-store";
import type { ToolInterface } from "./tool-interface";

/**
 * Input accepted by the demo write tool.
 */
interface WriteToolInput {
  key: string;
  content: string;
}

/**
 * Options for creating the demo write tool.
 */
interface CreateWriteToolOptions {
  fileStore: LocalStorageFileStore;
}

export function createWriteTool(
  options: CreateWriteToolOptions,
): ToolInterface<WriteToolInput, { key: string; written: true; size: number }> {
  return {
    name: "write",
    description: "Create or overwrite a file in the local demo workspace.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The file key to write." },
        content: {
          type: "string",
          description: "The full content to write into the file.",
        },
      },
      required: ["key", "content"],
      additionalProperties: false,
    },
    async execute(_toolCallId, input) {
      return options.fileStore.write(input.key, input.content);
    },
  };
}
