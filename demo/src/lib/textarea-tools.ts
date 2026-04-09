import type { AgentMessage, ToolDefinition } from "@oneai/web-agent";

export interface TextSelection {
  start: number;
  end: number;
}

export interface TextareaSnapshot {
  value: string;
  selection: TextSelection;
  length: number;
}

export interface TextareaToolTarget {
  read(): TextareaSnapshot;
  apply(value: string, selection: TextSelection): TextareaSnapshot;
}

interface ReadArgs {
  includeText?: boolean;
}

interface CreateArgs {
  text: string;
  index?: number;
}

interface UpdateArgs {
  text: string;
  start?: number;
  end?: number;
}

interface DeleteArgs {
  start?: number;
  end?: number;
  mode?: "selection" | "all";
}

export function createTextareaTools(
  target: TextareaToolTarget,
): Array<ToolDefinition<unknown, unknown, AgentMessage>> {
  return [
    createReadTool(target),
    createInsertTool(target),
    createUpdateTool(target),
    createDeleteTool(target),
  ];
}

function createReadTool(
  target: TextareaToolTarget,
): ToolDefinition<ReadArgs, TextareaSnapshot, AgentMessage> {
  return {
    name: "textarea_read",
    description: "读取文本框当前内容、长度和选区，编辑前如果不确定上下文先调用这个工具。",
    inputSchema: {
      type: "object",
      properties: {
        includeText: {
          type: "boolean",
          description: "是否返回完整文本内容，默认 true。",
        },
      },
      additionalProperties: false,
    },
    async execute({ input }) {
      const snapshot = target.read();
      const includeText = input.includeText ?? true;
      return createToolResult(
        [
          `Textarea length: ${snapshot.length}`,
          `Selection: ${snapshot.selection.start}-${snapshot.selection.end}`,
          includeText ? `Current text:\n${snapshot.value || "(empty)"}` : "Full text omitted by request.",
        ].join("\n\n"),
        snapshot,
      );
    },
  };
}

function createInsertTool(
  target: TextareaToolTarget,
): ToolDefinition<CreateArgs, TextareaSnapshot, AgentMessage> {
  return {
    name: "textarea_create",
    description: "在文本框插入新内容。默认插入到当前光标位置，也可以显式指定 index。",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "要插入的文本内容。",
        },
        index: {
          type: "number",
          description: "插入位置。缺省时使用当前选区起点。",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    async execute({ input }) {
      const current = target.read();
      const insertionPoint = clampIndex(input.index ?? current.selection.start, current.length);
      const nextValue =
        current.value.slice(0, insertionPoint) + input.text + current.value.slice(insertionPoint);
      const snapshot = target.apply(nextValue, {
        start: insertionPoint,
        end: insertionPoint + input.text.length,
      });
      return createToolResult(
        [
          `Inserted ${input.text.length} characters.`,
          `Selection is now ${snapshot.selection.start}-${snapshot.selection.end}.`,
          `Updated text:\n${snapshot.value || "(empty)"}`,
        ].join("\n\n"),
        snapshot,
      );
    },
  };
}

function createUpdateTool(
  target: TextareaToolTarget,
): ToolDefinition<UpdateArgs, TextareaSnapshot, AgentMessage> {
  return {
    name: "textarea_update",
    description: "替换文本框中的一段内容。未提供 range 时优先替换当前选区，若没有选区则替换整段文本。",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "替换后的文本。",
        },
        start: {
          type: "number",
          description: "替换起点。",
        },
        end: {
          type: "number",
          description: "替换终点，必须大于等于 start。",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    async execute({ input }) {
      const current = target.read();
      const rangeStart = clampIndex(
        input.start ?? (current.selection.start !== current.selection.end ? current.selection.start : 0),
        current.length,
      );
      const rangeEnd = clampIndex(
        input.end ??
          (current.selection.start !== current.selection.end ? current.selection.end : current.length),
        current.length,
      );
      const normalizedStart = Math.min(rangeStart, rangeEnd);
      const normalizedEnd = Math.max(rangeStart, rangeEnd);
      const nextValue =
        current.value.slice(0, normalizedStart) + input.text + current.value.slice(normalizedEnd);
      const snapshot = target.apply(nextValue, {
        start: normalizedStart,
        end: normalizedStart + input.text.length,
      });
      return createToolResult(
        [
          `Replaced text and selected ${snapshot.selection.start}-${snapshot.selection.end}.`,
          `Updated text:\n${snapshot.value || "(empty)"}`,
        ].join("\n\n"),
        snapshot,
      );
    },
  };
}

function createDeleteTool(
  target: TextareaToolTarget,
): ToolDefinition<DeleteArgs, TextareaSnapshot, AgentMessage> {
  return {
    name: "textarea_delete",
    description: "删除文本框中的一段内容。默认删除当前选区；传入 mode=all 时清空整个文本框。",
    inputSchema: {
      type: "object",
      properties: {
        start: {
          type: "number",
          description: "删除起点。",
        },
        end: {
          type: "number",
          description: "删除终点。",
        },
        mode: {
          type: "string",
          enum: ["selection", "all"],
          description: "删除模式。",
        },
      },
      additionalProperties: false,
    },
    async execute({ input }) {
      let snapshot: TextareaSnapshot;

      if (input.mode === "all") {
        snapshot = target.apply("", { start: 0, end: 0 });
      } else {
        const current = target.read();
        const rangeStart = clampIndex(input.start ?? current.selection.start, current.length);
        const rangeEnd = clampIndex(input.end ?? current.selection.end, current.length);
        const normalizedStart = Math.min(rangeStart, rangeEnd);
        const normalizedEnd = Math.max(rangeStart, rangeEnd);

        if (normalizedStart === normalizedEnd) {
          snapshot = current;
        } else {
          const nextValue = current.value.slice(0, normalizedStart) + current.value.slice(normalizedEnd);
          snapshot = target.apply(nextValue, {
            start: normalizedStart,
            end: normalizedStart,
          });
        }
      }

      return createToolResult(
        [
          `Delete applied. Length is now ${snapshot.length}.`,
          `Selection collapsed at ${snapshot.selection.start}.`,
          `Updated text:\n${snapshot.value || "(empty)"}`,
        ].join("\n\n"),
        snapshot,
      );
    },
  };
}

function createToolResult(text: string, snapshot: TextareaSnapshot) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    details: snapshot,
  };
}

export function clampSelection(selection: TextSelection, length: number): TextSelection {
  const start = clampIndex(selection.start, length);
  const end = clampIndex(selection.end, length);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

export function createSnapshot(value: string, selection: TextSelection): TextareaSnapshot {
  const nextSelection = clampSelection(selection, value.length);
  return {
    value,
    selection: nextSelection,
    length: value.length,
  };
}

export function clampIndex(index: number, length: number) {
  return Math.min(Math.max(Math.floor(index), 0), length);
}
