# AI model policy

## Provider and model

Nocturne calls the DeepSeek API directly at `https://api.deepseek.com/chat/completions`.
The only permitted model is `deepseek-v4-flash`. The model identifier is pinned in code and cannot be changed through user input or environment variables.

Production requires `DEEPSEEK_API_KEY`. There is no secondary provider or model fallback. Local deterministic fallbacks remain available only when `NOCTURNE_ALLOW_DETERMINISTIC_AI_FALLBACK=true` is explicitly enabled.

## Task policy

| Task                         | Authority     | User override |
| ---------------------------- | ------------- | ------------- |
| Parse action intent          | Authoritative | No            |
| Normalize generated content  | Authoritative | No            |
| Analyze arbitrary consumable | Authoritative | No            |
| Propose adjudication factors | Authoritative | No            |
| Plan NPC actions             | Authoritative | No            |
| Summarize persistent memory  | Authoritative | No            |
| Brainstorm player content    | Creative      | No            |
| Narrate committed event      | Creative      | No            |
| Private character assistant  | Creative      | No            |

The authority classification changes prompting and temperature; it does not change the provider or model.

## Structured output

Structured calls use DeepSeek JSON mode with:

- `model: deepseek-v4-flash`;
- `thinking: { type: "disabled" }`;
- `response_format: { type: "json_object" }`;
- an explicit JSON schema and example object in the system prompt; and
- runtime validation with the corresponding Zod schema.

DeepSeek JSON mode guarantees valid JSON, not application-schema compliance. No model response may mutate world state until it passes runtime validation and the deterministic authority layer commits the resulting operations.

Provider rejections, malformed output, and schema failures are logged as infrastructure errors rather than in-world failures. The request adapter must preserve DeepSeek's response status and error message internally while returning only sanitized error information to players.
