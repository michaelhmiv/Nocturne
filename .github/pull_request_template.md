## Change summary

Describe the player-facing or architectural behavior changed.

## Authority and durable state

- What state can this change read?
- What state can this change write?
- Does an AI model propose any part of the result?
- Which deterministic validation and authority boundary prevents unauthorized state changes?
- Which tables, events, mutation receipts, resources, relations, plans, steps, or schedules should change?
- Which authoritative rows must not change on failure?

## Capability impact

- [ ] No action or system capability changed.
- [ ] Updated `ACTION_CAPABILITIES` for every affected action type.
- [ ] Updated `SYSTEM_CAPABILITIES` for every affected cross-cutting mechanic.
- [ ] Added or revised canonical browser prompts.
- [ ] Added deterministic fake-provider fixtures for new AI tasks or schemas.

## Certification

- [ ] Formatting passes.
- [ ] Typecheck passes.
- [ ] Unit tests pass.
- [ ] Production workspace build passes.
- [ ] Clean and repeated migrations pass.
- [ ] Database invariants pass.
- [ ] Compiled API integration covers the change.
- [ ] Browser certification covers player-visible behavior.
- [ ] Worker restart/retry coverage exists for asynchronous behavior.
- [ ] Provider failures commit no false gameplay outcome.
- [ ] Idempotent replay creates no duplicate state.
- [ ] Structured telemetry includes stable stage, trace, request, and error information.

## Database and Railway

- [ ] No migration required.
- [ ] Migration included and reviewed.
- [ ] No new Railway variable required.
- [ ] New variables documented in `.env.example`, Railway documentation, and provider/deployment workflows.

List the exact variables added, removed, or changed. State `None` when no configuration changes are required.

## Rollout and rollback

State how the change will be certified after deployment and how it can be disabled or reverted without corrupting persistent world state.

## Known limitations

List intentionally deferred scenarios. A missing test for affected behavior is not an acceptable limitation unless the PR remains draft and cannot merge through the required certification gate.
