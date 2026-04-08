import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { RuntimeChat } from "../src/runtime-chat";

describe("RuntimeChat", () => {
  it("replaces and appends messages while notifying state changes", () => {
    const onStateChange = vi.fn();
    const firstMessage: UIMessage = {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    };
    const secondMessage: UIMessage = {
      id: "message-2",
      role: "assistant",
      parts: [{ type: "text", text: "hi" }],
    };
    const chat = new RuntimeChat<UIMessage>({
      messages: [] as UIMessage[],
      transport: {} as never,
      onStateChange,
    });

    chat.replaceAllMessages([firstMessage]);
    chat.appendMessages([secondMessage]);

    expect(chat.messages).toEqual([firstMessage, secondMessage]);
    expect(onStateChange).toHaveBeenCalledTimes(2);
  });
});
