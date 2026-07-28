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

- [ ] `pnpm verify`
- [ ] `pnpm build`
- [ ] `pnpm --filter @nocturne/database db:check` when migrations change
- [ ] Clean and repeated migration tested on disposable PostgreSQL when migrations change
- [ ] Relevant API/web/worker smoke test completed
- [ ] Better Auth SQL generated and reviewed when auth changes
- [ ] Railway/Hermes deployment check completed when applicable

State explicitly:

- whether real PostgreSQL was used;
- whether Railway was deployed/tested; and
- whether OpenRouter was called live or only mocked.

## Notes

List known limitations, follow-up work, or intentionally deferred decisions.
