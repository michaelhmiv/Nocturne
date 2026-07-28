## Summary

Describe the player-facing or architectural change.

## Authority and state

- What state can this change read?
- What state can this change write?
- Does an AI model propose any part of the result?
- Which backend validation prevents unauthorized state changes?

## Database and Railway

- [ ] No migration required
- [ ] Migration included and reviewed
- [ ] No new Railway variable required
- [ ] New variables documented in `.env.example` and `docs/RAILWAY.md`

## Verification performed

- [ ] `pnpm format:check`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] Relevant package build completed
- [ ] Relevant API/web smoke test completed
- [ ] Railway/Hermes deployment check completed when applicable

## Notes

List known limitations, follow-up work, or intentionally deferred decisions.
