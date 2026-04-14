# web-agent-runtime demo

## Usage

1. Install workspace dependencies from the repository root:
   `pnpm install`
2. Create a local env file in `packages/demo/`:
   `cp .env.example .env.local`
3. Set `VITE_OPENAI_API_KEY` in `.env.local`
4. Optionally set:
   `VITE_OPENAI_BASE_URL`
   `VITE_OPENAI_MODEL`
5. Start the demo from the repository root:
   `pnpm --filter web-agent-runtime-demo dev`
6. Open:
   `http://localhost:4179/`

Example `.env.local`:

```dotenv
VITE_OPENAI_API_KEY=your-local-demo-key
VITE_OPENAI_MODEL=qwen3-max
VITE_OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```
