# AI decision and generation policy

## Runtime architecture

Nocturne separates **decision inference** from **generation**.

**Jev / OpenRouter Decisions API** is the preferred low-latency decision layer. It receives bounded state plus typed Choice, Score, and Noul questions. It is used where the valid answer space can be enumerated safely: action routing, candidate/reference matching, ambiguity, plausibility buckets, reaction choices, severity bands, newsworthiness decisions, and similar classifications.

**Qwen3.7 Flash / OpenRouter chat completions** is the preferred generative layer. It is used for narration, dialogue wording, newspaper prose, memory summaries, content descriptions, and rich/open-ended structured proposals that cannot be represented as bounded Jev questions.

**Deterministic backend code remains authoritative.** Neither model owns inventory, money, ownership, location, access, physical state, clocks, rolls, legal state, idempotency, or database writes. AI answers are evidence used by server code, never commits.

## Production configuration

| Variable                 | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `AI_PROVIDER`            | Generation provider. Production default: `openrouter`                   |
| `AI_GENERATIVE_MODEL`    | Preferred generation model. Default: `qwen/qwen3.7-flash`               |
| `AI_MODEL`               | Backward-compatible generation-model alias                              |
| `AI_AUTHORITATIVE_MODEL` | Transitional override for rich structured generation tasks              |
| `AI_CREATIVE_MODEL`      | Optional override for prose/creative generation                         |
| `AI_BASE_URL`            | Generation provider base URL                                            |
| `AI_DECISION_MODEL`      | Jev decision model. Default: `~typesafe/jev-latest`                     |
| `AI_DECISION_ENDPOINT`   | OpenRouter Decisions endpoint                                           |
| `AI_DECISION_TIMEOUT_MS` | Hard decision timeout; default 5000 ms                                  |
| `AI_DECISION_API_KEY`    | Optional separate decision key; otherwise reuses OpenRouter/generic key |
| `OPENROUTER_API_KEY`     | Preferred shared production credential                                  |
| `AI_API_KEY`             | Generic generation credential override                                  |
| `AI_THINKING_MODE`       | Qwen/OpenRouter generation setting; normally `omit`                     |
| `AI_JSON_MODE`           | Request JSON-object mode for structured generation                      |
| `AI_MAX_TOKENS`          | Maximum generated tokens per structured call                            |
| `AI_TIMEOUT_MS`          | Generation timeout                                                      |

Recommended production values:

```text
AI_PROVIDER=openrouter
AI_GENERATIVE_MODEL=qwen/qwen3.7-flash
AI_MODEL=qwen/qwen3.7-flash
AI_AUTHORITATIVE_MODEL=qwen/qwen3.7-flash
AI_CREATIVE_MODEL=qwen/qwen3.7-flash
AI_BASE_URL=https://openrouter.ai/api/v1
AI_DECISION_MODEL=~typesafe/jev-latest
AI_DECISION_ENDPOINT=https://openrouter.ai/api/alpha/decisions
AI_DECISION_TIMEOUT_MS=5000
AI_THINKING_MODE=omit
```

## Routing policy

The synchronous player-action path is optimized in this order:

1. Compile authoritative/player-safe context deterministically.
2. Build and deterministically shortlist persistent reference candidates.
3. Make **one batched Jev decision request**. It answers the coarse handler kind, fine-grained Nocturne action type, ambiguity, multi-step requirement, and per-candidate reference probabilities together.
4. If Jev is high-confidence and the request is a supported single-step action, deterministic code constructs the persistent plan directly.
5. Simple movement to a resolved persistent location and explicit searches such as "find/search for X" are compiled deterministically without a generative planner call. If required payload fields cannot be proven safely, fall back to Qwen.
6. Consumption gets a second bounded Jev decision when needed. Ordinary food, ordinary nonalcoholic drinks, and clearly non-consumable cases use conservative deterministic mechanics; medicines, alcohol, drugs, toxins, fictional/unusual substances, and low-confidence cases fall back to Qwen semantic generation.
7. Search discovery uses Jev for bounded target-family/source selection and relative capability/difficulty scoring. The deterministic rules engine resolves the contest and commits discovery/materialization effects.
8. The backend adjudicates mechanics and commits authoritative events/receipts.
9. Qwen generates player-facing prose only **after** commit from player-visible facts. Trivial outcomes may remain deterministic rather than paying an unnecessary generation call.

This means ordinary interactions should not pay for a generative planner call before execution. Qwen is a fallback for semantic complexity and a post-commit prose layer.

## Jev decision rules

Jev must receive a bounded answer space. Prefer a single request containing multiple independent questions over sequential model calls.

Typical questions:

- Choice: terminal action kind.
- Choice: fine-grained action type such as detect, search, talk, attack, drive, arrest, buy, sell, interact, or ask.
- Noul: does this command require clarification?
- Noul: is this a compound/multi-step action?
- Noul per shortlisted candidate: does the command refer to this exact persistent entity?
- Score: search capability/difficulty, consequence severity, danger, or uncertainty band.
- Choice: authoritative candidate/source selection, NPC reaction class, evidence/publication class, or another allowlisted semantic bucket.

Jev may select only supplied IDs/options. Backend thresholds decide whether a response is accepted, escalated, or rejected. Low confidence never becomes a world-state failure; it triggers clarification or Qwen fallback.

## Generative policy

Qwen3.7 Flash handles:

- narration of committed events when richer prose is worth the extra call;
- NPC/dialogue wording after semantic choices are known;
- newspaper article text after deterministic evidence/newsworthiness selection;
- memory summaries;
- open-ended descriptions/materialization proposals;
- complex/compound action-plan proposals when the Jev fast path is not sufficient.

Generation is validated before use. Post-commit player-safe narration is additionally checked for unsupported death, injury, movement/arrival, ownership/possession, arrest/custody, and opaque persistent IDs. Structured generation continues to use runtime Zod validation and repair because provider JSON mode does not itself grant schema correctness.

## Authority boundary

The labels `authoritative` and `creative` in older telemetry describe **context/task classes**, not permission to mutate the world. All model output is non-authoritative until deterministic server logic validates prerequisites and commits the resulting operation.

No model may directly decide or write:

- balances, prices, inventory counts, ownership, or transfer completion;
- physical position/access when those facts already exist in world state;
- damage, injury, death, arrest, recovery, or timed work completion;
- random rolls or final contest outcomes;
- idempotency/replay behavior;
- database events or mutation receipts.

Provider rejection, timeout, malformed output, low confidence, and schema failure are infrastructure/decision-routing conditions—not in-world failures.

## Operational verification

`GET /v1/system/ai-provider` reports the effective non-secret generative configuration. The provider contract in GitHub Actions separately exercises both the Jev Decisions API and the Qwen structured-generation path with the trusted `OPENROUTER_API_KEY`.

Live model evaluations are diagnostic evidence, not release authority. Production promotion requires end-to-end action, browser, database, concurrency, and provider-contract certification.
