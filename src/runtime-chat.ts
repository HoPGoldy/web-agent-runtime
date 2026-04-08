import {
  AbstractChat,
  type ChatInit,
  type ChatState,
  type UIMessage,
} from "ai";

function cloneValue<T>(value: T) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

interface RuntimeChatOptions<
  UI_MESSAGE extends UIMessage,
> extends ChatInit<UI_MESSAGE> {
  onStateChange?: (state: ChatState<UI_MESSAGE>) => void;
}

export class RuntimeChat<
  UI_MESSAGE extends UIMessage,
> extends AbstractChat<UI_MESSAGE> {
  private readonly onStateChange?: (state: ChatState<UI_MESSAGE>) => void;

  constructor(options: RuntimeChatOptions<UI_MESSAGE>) {
    const messages = options.messages?.slice() ?? [];

    const notify = () => {
      options.onStateChange?.(stateRef);
    };

    const stateRef: ChatState<UI_MESSAGE> = {
      status: "ready",
      error: undefined,
      messages,
      pushMessage(message) {
        stateRef.messages = [...stateRef.messages, message];
        notify();
      },
      popMessage() {
        stateRef.messages = stateRef.messages.slice(0, -1);
        notify();
      },
      replaceMessage(index, message) {
        stateRef.messages = stateRef.messages.map((entry, entryIndex) =>
          entryIndex === index ? message : entry,
        );
        notify();
      },
      snapshot(thing) {
        return cloneValue(thing);
      },
    };

    super({ ...options, state: stateRef });
    this.onStateChange = options.onStateChange;
  }

  protected override setStatus(options: {
    status: "submitted" | "streaming" | "ready" | "error";
    error?: Error;
  }) {
    super.setStatus(options);
    this.onStateChange?.(this.state);
  }

  replaceAllMessages(messages: UI_MESSAGE[]) {
    this.state.messages = messages.slice();
    this.onStateChange?.(this.state);
  }

  appendMessages(messages: UI_MESSAGE[]) {
    this.state.messages = [...this.state.messages, ...messages];
    this.onStateChange?.(this.state);
  }
}
