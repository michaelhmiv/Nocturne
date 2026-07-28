# Contributing

## Branches and commits

Create a focused branch from `main`. Use clear commit messages that describe the architectural or gameplay change. Prefer squash merging for feature branches unless preserving individual commits is useful for review.

## Required review information

Every pull request should state:

- what player or system behavior changed;
- which authoritative state can change;
- whether AI output is involved;
- how invalid or adversarial input is handled;
- which manual tests were run; and
- whether a database migration or Railway variable is required.

## Definition of done

A change is not complete because the AI produced plausible prose. Consequential behavior must have validated contracts, an auditable resolution path, and committed event-ledger operations.

See [`docs/PR_TESTING.md`](docs/PR_TESTING.md).
