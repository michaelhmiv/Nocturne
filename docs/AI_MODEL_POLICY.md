# AI semantic and presentation policy

## Production architecture

Nocturne has three strict layers:

1. **Jev semantic decisions** translate natural-language intent and relevant world context into bounded machine-readable choices.
2. **Deterministic engine code and PostgreSQL** validate prerequisites, resolve mechanics, roll contests, advance clocks, and commit authoritative state.
3. **Laguna XS presentation** receives only committed player-visible/public facts and converts them into natural prose.

The intended player path is:

```text
player language
  -> deterministic context/candidate compiler
  -> Jev Decisions API
  -> engine-readable semantic packet
  -> deterministic rules / state commit
  -> committed player-safe facts
  -> Laguna XS plain-text narration
  -> player
```

The engine must be able to execute the action if Laguna is unavailable. Laguna can never change what happened.

## Jev

Production default:

```text
AI_DECISION_MODEL=~typesafe/jev-latest
AI_DECISION_ENDPOINT=https://openrouter.ai/api/alpha/decisions
```

Jev receives bounded Choice, Score, and Noul questions. It may select only supplied/allowlisted values.

Jev owns semantic interpretation such as:

- detailed action type;
- persistent entity references and semantic roles;
- ambiguity / clarification;
- compound-action detection and, in the compound protocol, ordered semantic steps;
- consumable/search/reaction/evidence/newsworthiness categories;
- bounded relative semantic scores.

Jev does **not** own location truth, access, inventory, possession, ownership, money, clocks, rolls, damage, legal state, idempotency, or database writes. Confidence is routing metadata, never gameplay success probability.

A normal generative model is not a fallback for player-command interpretation. If Jev cannot produce a usable semantic packet, the system asks another bounded Jev question, requests player clarification, or rejects the interpretation.

## Deterministic engine

Engine/database authority includes:

- location, containment, access, routes, visibility and presence;
- money, quantities, inventory, possession, ownership and transfers;
- timing, schedules, travel/work progress and response windows;
- contest rolls, damage, injury, incapacitation, recovery and legal state;
- atomic events, receipts, idempotency, concurrency and replay.

Semantic decisions become authoritative only after deterministic validation and commit.

## Laguna XS

Production default:

```text
AI_NARRATION_MODEL=poolside/laguna-xs-2.1
```

Laguna is presentation-only. Narration uses plain chat-completion text with reasoning disabled. It does not use JSON schema or `response_format`.

Laguna receives committed player-visible/public facts plus style constraints. Small non-material connective texture is allowed. Material state changes, causes, identities, injuries, ownership changes, arrivals, arrests, or other consequential facts must come from committed facts.

If deterministic hard narration checks reject a Laguna draft, Nocturne retries **Laguna XS once** with a correction prompt. If that also fails, the caller uses deterministic fallback prose. No second narration model is used.

## Transitional structured generation

`AI_GENERATIVE_MODEL=qwen/qwen3.7-flash` remains temporarily available for legacy non-player structured tasks while they are migrated. It is **not** the player-action planner and is **not** the narrator.

The system-wide migration audit must eventually classify each AI call as:

- semantic decision -> Jev;
- authoritative calculation/mutation -> code/database;
- presentation of committed facts -> Laguna;
- otherwise remove or explicitly justify the remaining structured-generation task.

## Preferred environment

```text
AI_PROVIDER=openrouter
AI_GENERATIVE_MODEL=qwen/qwen3.7-flash
AI_MODEL=qwen/qwen3.7-flash
AI_AUTHORITATIVE_MODEL=qwen/qwen3.7-flash
AI_CREATIVE_MODEL=qwen/qwen3.7-flash
AI_NARRATION_MODEL=poolside/laguna-xs-2.1
AI_BASE_URL=https://openrouter.ai/api/v1

AI_DECISION_MODEL=~typesafe/jev-latest
AI_DECISION_ENDPOINT=https://openrouter.ai/api/alpha/decisions
AI_DECISION_TIMEOUT_MS=5000

AI_THINKING_MODE=omit
OPENROUTER_API_KEY=...
```

## Required verification

Every AI-facing change must run:

- deterministic fake-Jev/fake-Laguna unit and integration coverage;
- full TypeScript/build/database/action/browser certification;
- live Jev Decisions contract;
- held-out Jev semantic accuracy and latency/cost evaluation;
- live Laguna plain-text narration contract;
- Laguna fidelity/latency/cost corpus;
- prompt-injection and hidden-fact leakage cases;
- timeout/429/5xx and deterministic-fallback tests.

Provider problems are infrastructure errors, not in-world failures. Missing credentials or blocked live checks are never reported as passes.
