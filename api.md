# OpenAI-Compatible API Plan (for Gemini CLI UI)

## Goal
Expose a minimal, **OpenAI API–compatible** HTTP interface on the existing backend so standard OpenAI SDKs/tools can talk to this app (which in turn talks to the configured `CLI_PROVIDER`: `gemini`, `codex`, `claude`, or `webllm`).

## Scope (v1)
- Implement OpenAI-style endpoints under `/v1`:
  - `GET /v1/models`
  - `POST /v1/chat/completions` (including `stream: true` via SSE)
- Keep existing UI/API (`/api/*`, WebSocket `/ws`, `/shell`) unchanged.

## Non-goals (initially)
- Full parity with OpenAI `responses` API, tool-calls, audio/image generation, batching, fine-tuning, files, etc.
- Perfect token accounting (`usage.*` will be best-effort).

## Compatibility decisions
### Authentication
Choose one (or support both):
1) **OpenAI-style**: `Authorization: Bearer <token>` validated against `OPENAI_COMPAT_API_KEY`
2) Reuse existing `/api` auth middleware (JWT login flow) for `/v1` as well

Recommended: support both; easiest client onboarding is (1).

### Model IDs
- Return model IDs from `server/cli-config.js` model catalog (per provider).
- Accept any `model` string and pass-through to the underlying provider; if unknown, fall back to provider default.

### Stateless vs sessionful
OpenAI requests are stateless (clients send full `messages` each time). The CLI providers are sessionful.
Plan:
- Default: **stateless** adapter that converts `messages[]` → a single prompt string.
- Optional: allow `metadata.session_id` (or header `x-session-id`) to reuse a CLI session for long-running threads.

## Endpoint mapping
### `GET /v1/models`
Return OpenAI-compatible shape:
```json
{
  "object": "list",
  "data": [{ "id": "gemini-2.5-flash", "object": "model", "owned_by": "local" }]
}
```

### `POST /v1/chat/completions`
Accept (subset):
- `model` (string)
- `messages` (array of `{role, content}`; `content` may be string; optionally handle the “multimodal array” form)
- `stream` (boolean)
- `temperature`, `top_p`, `max_tokens` (best-effort mapping; may be ignored by CLI providers)

Return:
- Non-stream: `object: "chat.completion"` with `choices[0].message`.
- Stream: SSE events compatible with OpenAI Chat Completions streaming (`chat.completion.chunk` deltas).

## Message conversion (OpenAI → CLI prompt)
Rules (simple + predictable):
- `system`: prepend as a “system instruction” block.
- `user`/`assistant`: serialize as a transcript.
- If `messages[].content` is the OpenAI “array parts” form:
  - `type: "text"` parts: concatenate
  - `type: "image_url"` parts:
    - If `image_url.url` is a `data:` URI, pass as `images[]` to `spawnGemini` (already supported)
    - If it’s an `http(s)` URL, return `400` in v1 (no network fetch), or add an explicit `ALLOW_REMOTE_IMAGE_FETCH=1` later

Example serialized prompt:
```
[System]
You are a helpful assistant...

[Conversation]
User: ...
Assistant: ...
User: ...
```

## Streaming design (SSE)
Implement `stream: true` using `Content-Type: text/event-stream` and emit:
- `data: { "id": "...", "object": "chat.completion.chunk", "choices":[{"delta":{"content":"..."}}] }\n\n`
- final: `data: [DONE]\n\n`

Internally, refactor `server/gemini-cli.js:spawnGemini()` so it can stream chunks to:
- WebSocket (current behavior)
- HTTP SSE writer (new)

Suggested approach:
- Extract a provider-agnostic “runner” that yields `{type, text, ...}` events (async iterator)
- Adapters:
  - `wsAdapter(event)` → `ws.send(JSON.stringify(...))`
  - `sseAdapter(event)` → `res.write("data: ...\n\n")`

## Implementation steps
1) Add a new router `server/routes/openai.js` mounted at `/v1`.
2) Add auth middleware for `/v1` (`Authorization: Bearer …`), configurable via env:
   - `OPENAI_COMPAT_API_KEY` (required to enable)
   - `OPENAI_COMPAT_ENABLED=1` (optional explicit flag)
3) Implement `GET /v1/models` by reading `getCliInfo(req.query.provider)` and returning catalog values.
4) Implement `POST /v1/chat/completions`:
   - Validate JSON body, normalize messages, build prompt, extract inline images.
   - Choose `provider`, `model`, `projectPath/cwd` (either a configured default or `metadata.project_path`).
5) Refactor `spawnGemini` to support an event sink (WS or SSE) without duplicating logic.
6) Add error mapping:
   - Return OpenAI-style errors: `{ "error": { "message": "...", "type": "invalid_request_error" } }`
7) Add minimal test coverage (if test harness exists) or a script under `test/`:
   - `curl` non-stream + stream
   - Validate shapes and SSE framing
8) Update README with:
   - how to enable `/v1`
   - example `curl` and OpenAI SDK base URL config

## Example usage
Non-stream:
```bash
curl http://localhost:4008/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_COMPAT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role":"user","content":"Say hi"}]
  }'
```

Stream:
```bash
curl -N http://localhost:4008/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_COMPAT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "stream": true,
    "messages": [{"role":"user","content":"Stream a short poem"}]
  }'
```

