# AI provider and model policy

## Runtime configuration

Nocturne uses an OpenAI-compatible chat-completions adapter. The active provider and model are server-controlled through Railway variables; player input can never select or override either one.

Primary variables:

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `deepseek`, `openai`, `openrouter`, or `openai_compatible` |
| `AI_MODEL` | Default model ID for every task |
| `AI_AUTHORITATIVE_MODEL` | Optional override for planning, semantic analysis, and other authoritative tasks |
| `AI_CREATIVE_MODEL` | Optional override for narration and other creative tasks |
| `AI_BASE_URL` | Provider base URL; required for `openai_compatible` |
| `AI_API_KEY` | Generic provider key; overrides a provider-specific key |
| `AI_THINKING_MODE` | `enabled`, `disabled`, or `omit` |
| `AI_JSON_MODE` | Whether to send OpenAI-compatible JSON response mode |
| `AI_MAX_TOKENS` | Maximum generated tokens per structured call |
| `AI_TIMEOUT_MS` | Provider request timeout |
| `AI_EXTRA_BODY_JSON` | Optional provider-specific request fields as a JSON object |

Provider-specific fallback keys are `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, and `OPENROUTER_API_KEY`.

The production default is:

```text
AI_PROVIDER=deepseek
AI_MODEL=deepseek-v4-flash
AI_AUTHORITATIVE_MODEL=deepseek-v4-flash
AI_CREATIVE_MODEL=deepseek-v4-flash
AI_BASE_URL=https://api.deepseek.com
AI_THINKING_MODE=disabled
```

Changing the provider or model requires a Railway variable update and service redeployment, not a code change. The effective non-secret configuration is exposed at `GET /v1/system/ai-provider` for operational verification.

## Task policy

| Task | Authority | Player override |
| --- | --- | --- |
| Parse action intent | Authoritative | No |
| Resolve persistent entity references | Authoritative | No |
| Plan persistent world actions | Authoritative | No |
| Analyze arbitrary consumables | Authoritative | No |
| Analyze searches and materialization | Authoritative | No |
| Simulate elapsed entity time | Authoritative | No |
| Normalize generated content | Authoritative | No |
| Propose adjudication factors | Authoritative | No |
| Plan NPC actions | Authoritative | No |
| Summarize persistent memory | Authoritative | No |
| Brainstorm player content | Creative | No |
| Narrate committed events | Creative | No |
| Private character assistant | Creative | No |

Authority classification controls default temperature and model-class selection. It never grants the model authority to write world state.

## Structured output

Structured calls include:

- the configured provider and model;
- an explicit JSON schema and generated example object in the system prompt;
- OpenAI-compatible JSON mode unless `AI_JSON_MODE=false`;
- runtime validation with the corresponding Zod schema; and
- one targeted schema-repair retry when the first JSON object is structurally invalid.

For direct DeepSeek V4 structured calls, thinking mode defaults to disabled. Other providers omit the nonstandard `thinking` field unless explicitly configured.

No model response may mutate world state until it passes runtime validation and the deterministic authority layer commits the resulting operations. Provider rejections, timeouts, malformed output, and schema failures are infrastructure errors and must never be presented as in-world action failures.
