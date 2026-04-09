import type { AssistantMessage, RuntimeEvent, RuntimeState, ToolCallBlock } from "@oneai/web-agent";

export function formatClock(value: number | string) {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function findLatestAssistant(state: RuntimeState | null): AssistantMessage | null {
  if (!state) {
    return null;
  }

  if (state.streamMessage) {
    return state.streamMessage;
  }

  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message.role === "assistant") {
      return message;
    }
  }

  return null;
}

export function extractAssistantText(message: AssistantMessage | null) {
  if (!message) {
    return "";
  }

  return message.content
    .flatMap((block) => {
      if (block.type === "text") {
        return [block.text];
      }

      if (block.type === "thinking") {
        return [`[thinking] ${block.text}`];
      }

      return [];
    })
    .join("\n\n")
    .trim();
}

export function extractToolCalls(message: AssistantMessage | null) {
  if (!message) {
    return [] as ToolCallBlock[];
  }

  return message.content.filter((block): block is ToolCallBlock => block.type === "toolCall");
}

export function summarizeRuntimeEvent(event: RuntimeEvent) {
  switch (event.type) {
    case "state_changed":
      return `status=${event.state.status} messageCount=${event.state.messages.length}`;
    case "session_created":
      return `created ${event.session.id}`;
    case "session_opened":
      return `opened ${event.session.id}`;
    case "session_updated":
      return `updated ${event.session.id}`;
    case "session_deleted":
      return `deleted ${event.sessionId}`;
    case "session_forked":
      return `forked from ${event.sourceSessionId} to ${event.session.id}`;
    case "agent_start":
      return "loop started";
    case "agent_end":
      return `loop ended with ${event.messages.length} messages`;
    case "turn_start":
      return "turn started";
    case "turn_end":
      return `turn ended with ${event.toolResults.length} tool result(s)`;
    case "message_start":
      return "assistant stream opened";
    case "message_update":
      return "assistant stream updated";
    case "message_end":
      return "assistant message committed";
    case "tool_execution_start":
      return `${event.toolName} started`;
    case "tool_execution_update":
      return `${event.toolName} partial update`;
    case "tool_execution_end":
      return `${event.toolName} ${event.isError ? "failed" : "completed"}`;
    case "compaction_start":
      return `compacting ${event.sessionId}`;
    case "compaction_end":
      return `compaction kept from ${event.result.firstKeptEntryId}`;
    case "destroyed":
      return "runtime destroyed";
    default:
      return "unknown event";
  }
}
