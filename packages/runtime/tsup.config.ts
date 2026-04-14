import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "local-storage": "src/local-storage.ts",
    "unsafe-openai": "src/llm/create-unsafe-openai-provider.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
