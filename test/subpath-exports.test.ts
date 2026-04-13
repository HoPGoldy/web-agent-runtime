import { describe, expect, it } from "vitest";

describe("package subpath exports", () => {
  it("keeps optional LLM adapters out of the root entry", async () => {
    const rootModule = await import("../src/index");

    expect(rootModule).not.toHaveProperty("createAiSdkLlmProvider");
    expect(rootModule).not.toHaveProperty("createAiSdkToolSet");
    expect(rootModule).not.toHaveProperty("createOpenAiCompatibleLlmProvider");
    expect(rootModule).not.toHaveProperty("createResultStream");
  });

  it("exposes AI SDK helpers from the ai-sdk subpath", async () => {
    const aiSdkModule = await import("../src/entries/ai-sdk");

    expect(aiSdkModule).toHaveProperty("createAiSdkLlmProvider");
    expect(aiSdkModule).toHaveProperty("createAiSdkToolSet");
  });

  it("exposes the OpenAI-compatible adapter from its subpath", async () => {
    const openAiCompatibleModule = await import("../src/entries/openai-compatible");

    expect(openAiCompatibleModule).toHaveProperty("createOpenAiCompatibleLlmProvider");
  });

  it("exposes provider utilities from the provider-utils subpath", async () => {
    const providerUtilsModule = await import("../src/entries/provider-utils");

    expect(providerUtilsModule).toHaveProperty("createResultStream");
  });
});
