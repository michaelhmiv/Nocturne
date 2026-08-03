import postgres from "postgres";
import { DEFAULT_WORLD_ID } from "./world-schema.js";

const allowedRoles = new Set(["player", "moderator", "operator", "owner"] as const);
type WorldRole = "player" | "moderator" | "operator" | "owner";

async function main() {
  const [emailInput, roleInput] = process.argv.slice(2);
  const email = emailInput?.trim().toLowerCase();
  const role = roleInput?.trim().toLowerCase() as WorldRole | undefined;
  if (!email || !role || !allowedRoles.has(role)) {
    throw new Error(
      "Usage: pnpm world:grant-role <account-email> <player|moderator|operator|owner>",
    );
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const users = await sql<{ id: string; email: string }[]>`
      SELECT id, email
      FROM auth."user"
      WHERE lower(email) = ${email}
      LIMIT 2
    `;
    if (users.length !== 1) {
      throw new Error(
        users.length === 0
          ? `No Better Auth user exists for ${email}.`
          : `Multiple Better Auth users matched ${email}.`,
      );
    }
    const user = users[0]!;
    const previous = await sql<{ role: string; status: string }[]>`
      SELECT role, status
      FROM game.world_memberships
      WHERE world_id = ${DEFAULT_WORLD_ID}
        AND user_id = ${user.id}
    `;
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO game.world_memberships (world_id, user_id, role, status)
        VALUES (${DEFAULT_WORLD_ID}, ${user.id}, ${role}, 'active')
        ON CONFLICT (world_id, user_id) DO UPDATE
        SET role = EXCLUDED.role,
            status = 'active',
            updated_at = now()
      `;
      await transaction`
        INSERT INTO auth.admin_audit_log
          (actor, action, target_user_id, details)
        VALUES (
          'grant-world-role-script',
          'world_role_changed',
          ${user.id},
          ${transaction.json({
            worldId: DEFAULT_WORLD_ID,
            email: user.email,
            previousRole: previous[0]?.role || null,
            previousStatus: previous[0]?.status || null,
            newRole: role,
          })}
        )
      `;
    });
    console.log(
      JSON.stringify({
        event: "world_role_changed",
        worldId: DEFAULT_WORLD_ID,
        userId: user.id,
        email: user.email,
        previousRole: previous[0]?.role || null,
        role,
      }),
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
