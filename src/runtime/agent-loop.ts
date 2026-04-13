import type { LlmProvider, ToolDefinition, ToolExecutionMode, ToolExecutionResult } from "../types/provider";
import type {
  AgentLoopBindings,
  AfterToolCallResult,
  BeforeToolCallResult,
  CompactionResult,
  PromptInput,
  RuntimeEvent,
  RuntimeState,
} from "../types/runtime";
import type {
  AgentMessage,
  AssistantMessage,
  ToolCallBlock,
  ToolResultContentBlock,
  ToolResultMessage,
  UserMessage,
} from "../types/session";
import {
  traceRuntimeDebug,
  traceRuntimeError,
  traceRuntimeInfo,
  traceRuntimeWarning,
  type RuntimeLogger,
} from "../utils/debug";

const MAX_TURNS_PER_RUN = 12;

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createUserMessage(text: string): UserMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
}

function normalizePromptInput(input: PromptInput | undefined): AgentMessage[] {
  if (input === undefined) {
    return [];
  }

  if (typeof input === "string") {
    return [createUserMessage(input)];
  }

  if (Array.isArray(input)) {
    return input as AgentMessage[];
  }

  return [input as AgentMessage];
}

function normalizeToolResultContent(content: unknown[]): ToolResultContentBlock[] {
  return content.map((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      (item.type === "text" || item.type === "image")
    ) {
      return item as ToolResultContentBlock;
    }

    return {
      type: "text",
      text: typeof item === "string" ? item : JSON.stringify(item),
    };
  });
}

function getToolCalls(message: AssistantMessage): ToolCallBlock[] {
  return message.content.filter((block): block is ToolCallBlock => block.type === "toolCall");
}

export class AgentLoopEngine<THostContext = unknown> {
  private abortController = new AbortController();
  private running = false;

  constructor(private readonly bindings: AgentLoopBindings<THostContext>) {}

  get isRunning() {
    return this.running;
  }

  abort() {
    this.abortController.abort();
  }

  async run(input?: PromptInput) {
    if (this.running) {
      throw new Error("Agent loop is already running");
    }

    this.running = true;
    this.abortController = new AbortController();
    this.bindings.setStatus("streaming");
    this.bindings.emit({ type: "agent_start" });
    let pendingMessages = normalizePromptInput(input);
    let turnCount = 0;
    traceRuntimeInfo(this.bindings.logger, "loop:run:start", {
      pendingMessageCount: pendingMessages.length,
    });

    try {
      while (true) {
        if (turnCount >= MAX_TURNS_PER_RUN) {
          throw new Error(
            `Agent loop exceeded ${MAX_TURNS_PER_RUN} turns. Possible repeated tool-call cycle.`,
          );
        }

        turnCount += 1;
        traceRuntimeDebug(this.bindings.logger, "loop:turn:start", {
          turnCount,
          pendingMessageCount: pendingMessages.length,
        });

        if (pendingMessages.length > 0) {
          traceRuntimeDebug(this.bindings.logger, "loop:pending-messages:append:start", {
            turnCount,
            pendingMessageCount: pendingMessages.length,
          });
          await this.bindings.appendMessages(pendingMessages);
          traceRuntimeDebug(this.bindings.logger, "loop:pending-messages:append:done", {
            turnCount,
          });
        }

        const turnResult = await this.runTurn(this.abortController.signal);
        const steeringMessages = this.bindings.consumeSteeringMessages();
        if (steeringMessages.length > 0) {
          pendingMessages = steeringMessages;
          await yieldToBrowser();
          continue;
        }

        if (turnResult.toolResults.length > 0) {
          pendingMessages = [];
          await yieldToBrowser();
          continue;
        }

        const followUpMessages = this.bindings.consumeFollowUpMessages();
        if (followUpMessages.length > 0) {
          pendingMessages = followUpMessages;
          await yieldToBrowser();
          continue;
        }

        break;
      }

      traceRuntimeInfo(this.bindings.logger, "loop:run:done", {
        messageCount: this.bindings.getMessages().length,
      });
      this.bindings.setStatus("ready");
      this.bindings.emit({
        type: "agent_end",
        messages: this.bindings.getMessages(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      traceRuntimeError(this.bindings.logger, "loop:run:error", {
        message,
      });
      this.bindings.setStatus("error", message);
      throw error;
    } finally {
      this.bindings.setStreamMessage(null);
      this.running = false;
      traceRuntimeDebug(this.bindings.logger, "loop:run:finally");
    }
  }

  private async runTurn(signal: AbortSignal) {
    traceRuntimeDebug(this.bindings.logger, "loop:runTurn:get-tools:start");
    const tools = await this.bindings.getTools();
    traceRuntimeDebug(this.bindings.logger, "loop:runTurn:get-tools:done", {
      toolCount: tools.length,
    });
    traceRuntimeDebug(this.bindings.logger, "loop:runTurn:build-context:start");
    const context = await this.bindings.buildLlmContext(tools, signal);
    traceRuntimeDebug(this.bindings.logger, "loop:runTurn:build-context:done", {
      toolCount: tools.length,
      messageCount: context.messages.length,
    });
    this.bindings.emit({ type: "turn_start" });
    traceRuntimeDebug(this.bindings.logger, "loop:runTurn:llm-provider:start");
    const stream = await this.bindings.llmProvider.stream({
      model: this.bindings.getState().model,
      reasoning: this.bindings.getState().thinkingLevel,
      sessionId: this.bindings.getState().session?.id,
      context: {
        systemPrompt: context.systemPrompt,
        messages: context.messages,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      },
      signal,
    });
    traceRuntimeDebug(this.bindings.logger, "loop:runTurn:llm-provider:done");
    let assistantMessage: AssistantMessage | null = null;

    for await (const event of stream) {
      if ("partial" in event) {
        this.bindings.setStreamMessage(event.partial as AssistantMessage);
      }

      if (event.type === "start") {
        this.bindings.emit({
          type: "message_start",
          message: event.partial as AssistantMessage,
        });
      }

      if (event.type === "done") {
        assistantMessage = event.message as AssistantMessage;
      }

      if (event.type === "error") {
        assistantMessage = event.error as AssistantMessage;
      }

      this.bindings.emit({
        type: "message_update",
        message: (("partial" in event ? event.partial : undefined) ??
          ("message" in event ? event.message : undefined) ??
          ("error" in event ? event.error : assistantMessage)) as AgentMessage,
        assistantEvent: event,
      });
    }

    if (!assistantMessage) {
      traceRuntimeDebug(this.bindings.logger, "loop:runTurn:stream-result:start");
      assistantMessage = (await stream.result()) as AssistantMessage;
      traceRuntimeDebug(this.bindings.logger, "loop:runTurn:stream-result:done", {
        stopReason: assistantMessage.stopReason,
        contentBlocks: assistantMessage.content.length,
      });
    }

    this.bindings.setStreamMessage(null);
    traceRuntimeDebug(this.bindings.logger, "loop:runTurn:append-assistant:start");
    await this.bindings.appendMessages([assistantMessage]);
    traceRuntimeDebug(this.bindings.logger, "loop:runTurn:append-assistant:done");
    this.bindings.emit({ type: "message_end", message: assistantMessage });
    const toolResults = await this.executeToolCalls(assistantMessage, tools, signal);
    traceRuntimeDebug(this.bindings.logger, "loop:runTurn:tool-calls:done", {
      toolResultCount: toolResults.length,
    });
    this.bindings.emit({
      type: "turn_end",
      message: assistantMessage,
      toolResults,
    });

    return {
      assistantMessage,
      toolResults,
    };
  }

  private async executeToolCalls(
    assistantMessage: AssistantMessage,
    tools: Array<ToolDefinition<unknown, unknown, AgentMessage, THostContext>>,
    signal: AbortSignal,
  ) {
    const toolCalls = getToolCalls(assistantMessage);
    if (toolCalls.length === 0) {
      return [] as ToolResultMessage[];
    }

    const executions = toolCalls.map(
      (toolCall) => () => this.executeSingleToolCall(assistantMessage, toolCall, tools, signal),
    );

    if (this.bindings.toolExecutionMode === "parallel") {
      return Promise.all(executions.map((execute) => execute()));
    }

    const results: ToolResultMessage[] = [];
    for (const execute of executions) {
      results.push(await execute());
    }

    return results;
  }

  private async executeSingleToolCall(
    assistantMessage: AssistantMessage,
    toolCall: ToolCallBlock,
    tools: Array<ToolDefinition<unknown, unknown, AgentMessage, THostContext>>,
    signal: AbortSignal,
  ) {
    const tool = tools.find((candidate) => candidate.name === toolCall.name);
    if (!tool) {
      traceRuntimeWarning(this.bindings.logger, "loop:tool-call:missing-tool", {
        toolName: toolCall.name,
      });
      const missingToolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Unsupported tool: ${toolCall.name}`,
          },
        ],
        isError: true,
        timestamp: Date.now(),
      };
      await this.bindings.appendMessages([missingToolMessage]);
      this.bindings.emit({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: { content: missingToolMessage.content },
        isError: true,
      });
      return missingToolMessage;
    }

    const stateBeforeCall = this.bindings.getState();
    const hostContext = await this.bindings.getHostContext();
    traceRuntimeDebug(this.bindings.logger, "loop:tool-call:start", {
      toolName: tool.name,
      toolCallId: toolCall.id,
    });
    this.bindings.emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: tool.name,
      args: toolCall.arguments,
    });
    const beforeResult = await this.bindings.beforeToolCall?.({
      assistantMessage,
      toolCall,
      args: toolCall.arguments,
      runtimeState: stateBeforeCall,
      hostContext,
    });

    if (beforeResult?.block) {
      const blockedResult: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: tool.name,
        content: [
          {
            type: "text",
            text: beforeResult.reason ?? `Blocked tool call: ${tool.name}`,
          },
        ],
        isError: true,
        timestamp: Date.now(),
      };
      await this.bindings.appendMessages([blockedResult]);
      this.bindings.emit({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: tool.name,
        result: { content: blockedResult.content },
        isError: true,
      });
      return blockedResult;
    }

    try {
      traceRuntimeDebug(this.bindings.logger, "loop:tool-call:execute:start", {
        toolName: tool.name,
        toolCallId: toolCall.id,
      });
      const executionResult = await tool.execute({
        toolCallId: toolCall.id,
        input: toolCall.arguments,
        context: {
          session: this.bindings.getState().session,
          messages: this.bindings.getMessages(),
          hostContext,
        },
        signal,
        onUpdate: (partial) => {
          this.bindings.emit({
            type: "tool_execution_update",
            toolCallId: toolCall.id,
            toolName: tool.name,
            args: toolCall.arguments,
            partialResult: partial,
          });
        },
      });
      traceRuntimeDebug(this.bindings.logger, "loop:tool-call:execute:done", {
        toolName: tool.name,
        toolCallId: toolCall.id,
      });
      const afterResult = await this.bindings.afterToolCall?.({
        assistantMessage,
        toolCall,
        args: toolCall.arguments,
        result: executionResult,
        isError: false,
        runtimeState: this.bindings.getState(),
        hostContext,
      });
      const finalResult: ToolExecutionResult = {
        content: afterResult?.content ?? executionResult.content,
        details: afterResult?.details ?? executionResult.details,
      };
      const toolResultMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: tool.name,
        content: normalizeToolResultContent(finalResult.content),
        details: finalResult.details,
        isError: afterResult?.isError ?? false,
        timestamp: Date.now(),
      };
      await this.bindings.appendMessages([toolResultMessage]);
      this.bindings.emit({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: tool.name,
        result: finalResult,
        isError: toolResultMessage.isError,
      });
      return toolResultMessage;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      traceRuntimeError(this.bindings.logger, "loop:tool-call:execute:error", {
        toolName: tool.name,
        toolCallId: toolCall.id,
        message: errorMessage,
      });
      const toolResultMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: tool.name,
        content: [{ type: "text", text: errorMessage }],
        isError: true,
        timestamp: Date.now(),
      };
      await this.bindings.appendMessages([toolResultMessage]);
      this.bindings.emit({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: tool.name,
        result: { content: toolResultMessage.content },
        isError: true,
      });
      return toolResultMessage;
    }
  }
}
