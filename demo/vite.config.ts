import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        localStorageChat: fileURLToPath(new URL("./local-storage-chat.html", import.meta.url)),
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^web-agent-runtime$/,
        replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      },
      {
        find: /^web-agent-runtime\/ai-sdk$/,
        replacement: fileURLToPath(new URL("../src/entries/ai-sdk.ts", import.meta.url)),
      },
      {
        find: /^web-agent-runtime\/openai-compatible$/,
        replacement: fileURLToPath(new URL("../src/entries/openai-compatible.ts", import.meta.url)),
      },
      {
        find: /^web-agent-runtime\/provider-utils$/,
        replacement: fileURLToPath(new URL("../src/entries/provider-utils.ts", import.meta.url)),
      },
    ],
  },
  server: {
    port: 4179,
  },
});
