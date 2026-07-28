# PR #2: Persistent player world

This branch implements the authenticated persistence, ownership, starter-world, command, and residence boundary required by the Nocturne v0.1 vertical slice.

## Commands

- Create and list player-controlled characters.
- Select the active character for an account.
- Seed and inspect the minimal Foundry Row starter world.
- Rent the starter apartment through an idempotent command.

## Review focus

- Better Auth user IDs never become implicit world authority.
- Routes call the persistent-world service rather than writing tables directly.
- Character creation and apartment rental append immutable events.
- Starter-world seed IDs are deterministic and safe to apply repeatedly.
- Browser calls use the same-origin Next.js game proxy so Railway web/API domains do not need to share auth cookies.

See issue #2 for acceptance criteria and deferred work.
