import type { LocalStorageFileStore } from "../local-storage-file-store";
import type { ToolInterface } from "./tool-interface";

interface EditToolInput {
  key: string;
  oldText: string;
  newText: string;
}

interface CreateEditToolOptions {
  fileStore: LocalStorageFileStore;
}

export function createEditTool(
  options: CreateEditToolOptions,
): ToolInterface<EditToolInput, { key: string; edited: true }> {
  return {
    name: "edit",
    description:
      "Replace an exact unique text fragment in a file. Read the file first when needed.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The file key to edit." },
        oldText: {
          type: "string",
          description: "The exact old text that must appear exactly once.",
        },
        newText: {
          type: "string",
          description: "The replacement text.",
        },
      },
      required: ["key", "oldText", "newText"],
      additionalProperties: false,
    },
    async execute(_toolCallId, input) {
      return options.fileStore.edit(input.key, input.oldText, input.newText);
    },
  };
}
