# AI model policy

## Default provider

OpenRouter is the initial provider. The default model slug is `openrouter/free`, configured through environment variables.

The API key is never committed. Set `OPENROUTER_API_KEY` in Railway.

## Central policy versus user selection

Nocturne requires a central model policy for shared-world fairness, but it does not require one permanent model for every task.

Authoritative tasks do not permit user overrides. Creative tasks may accept a user-selected OpenRouter model later. The model router records the actual model reported by the provider for auditability.

## Task policy

| Task | Authority | User override |
| --- | --- | --- |
| Parse action intent | Authoritative | No |
| Normalize generated content | Authoritative | No |
| Propose adjudication factors | Authoritative | No |
| Plan NPC actions | Authoritative | No |
| Summarize persistent memory | Authoritative | No |
| Brainstorm player content | Creative | Yes |
| Narrate committed event | Creative | Yes |
| Private character assistant | Creative | Yes |

## Structured output

Mechanical AI calls must request strict JSON Schema output and then validate the result with a runtime schema. An invalid response is retried or rejected; prose is never treated as a state mutation.

## Free-router limitation

`openrouter/free` is appropriate for development and early low-volume use. Production policy can pin or allowlist models per authoritative task without changing domain code.
