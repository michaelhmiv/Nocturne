import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, value) {
  writeFileSync(path, value);
}

function replaceOnce(path, source, replacement, label) {
  const current = read(path);
  const count = current.split(source).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match in ${path}, found ${count}`);
  write(path, current.replace(source, replacement));
}

function replaceRegex(path, pattern, replacement, label) {
  const current = read(path);
  const matches = current.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`${label}: expected one regex match in ${path}`);
  write(path, current.replace(pattern, replacement));
}

const characterContract = "packages/contracts/src/character.ts";
replaceOnce(
  characterContract,
  '  residenceId: z.string().uuid().nullable(),\n  createdAt: z.string().datetime(),',
  '  residenceId: z.string().uuid().nullable(),\n  residenceName: z.string().nullable().default(null),\n  createdAt: z.string().datetime(),',
  "character residence name contract",
);

const store = "packages/database/src/game-store.ts";
replaceOnce(
  store,
  `      await sql\`\n        UPDATE game.entity_instances SET created_event_id = \${eventId} WHERE instance_id = \${characterId}\n      \`;\n\n      return {`,
  `      await sql\`\n        UPDATE game.entity_instances SET created_event_id = \${eventId} WHERE instance_id = \${characterId}\n      \`;\n\n      const starterResidenceRows = await sql\`\n        SELECT residence_id, event_id, already_rented\n        FROM game.provision_starter_residence(\n          \${userId},\n          \${characterId},\n          \${\`starter-residence:\${characterId}\`}\n        )\n      \`;\n      const starterResidence = starterResidenceRows[0];\n      if (!starterResidence?.residence_id) {\n        throw new PersistentWorldError(\n          \"conflict\",\n          \"Starter housing could not be provisioned for the new character.\",\n        );\n      }\n      const residenceId = String(starterResidence.residence_id);\n      const residenceRows = await sql\`\n        SELECT d.name\n        FROM game.entity_instances i\n        JOIN game.entity_definitions d ON d.definition_id = i.definition_id\n        WHERE i.instance_id = \${residenceId}\n        LIMIT 1\n      \`;\n      const residenceName = residenceRows[0]?.name ? String(residenceRows[0].name) : null;\n\n      return {`,
  "atomic starter residence provisioning",
);
replaceOnce(
  store,
  `        locationId: STARTER_WORLD_IDS.neighborhood,\n        residenceId: null,\n        createdAt,`,
  `        locationId: residenceId,\n        residenceId,\n        residenceName,\n        createdAt,`,
  "new character residence result",
);
replaceOnce(
  store,
  `             d.definition_id, d.name, d.concept_summary, d.origin_source,\n             i.location_id, i.state, o.residence_instance_id\n      FROM game.player_characters pc\n      JOIN game.entity_instances i ON i.instance_id = pc.character_instance_id\n      JOIN game.entity_definitions d ON d.definition_id = i.definition_id\n      LEFT JOIN game.residence_occupancies o\n        ON o.character_instance_id = i.instance_id AND o.status = 'active'`,
  `             d.definition_id, d.name, d.concept_summary, d.origin_source,\n             i.location_id, i.state, o.residence_instance_id, rd.name AS residence_name\n      FROM game.player_characters pc\n      JOIN game.entity_instances i ON i.instance_id = pc.character_instance_id\n      JOIN game.entity_definitions d ON d.definition_id = i.definition_id\n      LEFT JOIN game.residence_occupancies o\n        ON o.character_instance_id = i.instance_id AND o.status = 'active'\n      LEFT JOIN game.entity_instances ri ON ri.instance_id = o.residence_instance_id\n      LEFT JOIN game.entity_definitions rd ON rd.definition_id = ri.definition_id`,
  "list character residence join",
);
replaceOnce(
  store,
  `        residenceId: row.residence_instance_id ? String(row.residence_instance_id) : null,\n        createdAt: asIso(row.created_at as Date),`,
  `        residenceId: row.residence_instance_id ? String(row.residence_instance_id) : null,\n        residenceName: row.residence_name ? String(row.residence_name) : null,\n        createdAt: asIso(row.created_at as Date),`,
  "list character residence name",
);
replaceRegex(
  store,
  /  async function rentStarterResidence\([\s\S]*?\n  \}\n\n  return \{/,
  `  async function rentStarterResidence(\n    userId: string,\n    characterId: string,\n    idempotencyKey: string,\n  ): Promise<RentResidenceResult> {\n    return database.client.begin(async (sql) => {\n      const controlled = await sql\`\n        SELECT 1 FROM game.player_characters\n        WHERE user_id = \${userId} AND character_instance_id = \${characterId}\n      \`;\n      if (controlled.length === 0) {\n        throw new PersistentWorldError(\n          \"forbidden\",\n          \"Character is not controlled by this account.\",\n        );\n      }\n\n      const provisioningKey = idempotencyKey.startsWith(\"starter-residence:\")\n        ? idempotencyKey\n        : \`starter-residence:\${characterId}\`;\n      const rows = await sql\`\n        SELECT residence_id, event_id, already_rented\n        FROM game.provision_starter_residence(\${userId}, \${characterId}, \${provisioningKey})\n      \`;\n      const row = rows[0];\n      if (!row?.residence_id || !row?.event_id) {\n        throw new PersistentWorldError(\n          \"conflict\",\n          \"Starter housing could not be provisioned.\",\n        );\n      }\n      return {\n        characterId,\n        residenceId: String(row.residence_id),\n        eventId: String(row.event_id),\n        alreadyRented: Boolean(row.already_rented),\n      };\n    });\n  }\n\n  return {`,
  "replace shared starter rental",
);

const apiTest = "apps/api/test/persistent-world.test.ts";
replaceOnce(
  apiTest,
  '    residenceId: null,\n    createdAt: new Date(0).toISOString(),',
  '    residenceId: "10000000-0000-4000-8000-000000000099",\n    residenceName: "Ashdown Apartments, Unit 2A",\n    createdAt: new Date(0).toISOString(),',
  "persistent world test residence",
);
replaceOnce(
  apiTest,
  '    expect(result.name).toBe("Night Engineer");',
  '    expect(result.name).toBe("Night Engineer");\n    expect(result.residenceName).toBe("Ashdown Apartments, Unit 2A");',
  "persistent world test assertion",
);

const web = "apps/web/app/scene-game-client.tsx";
replaceOnce(
  web,
  '  residenceId: string | null;\n  cashOnPerson?: number;',
  '  residenceId: string | null;\n  residenceName: string | null;\n  cashOnPerson?: number;',
  "web character residence name",
);
replaceOnce(
  web,
  '  const [renting, setRenting] = useState(false);\n',
  "",
  "remove renting state",
);
replaceRegex(
  web,
  /\n  async function rentResidence\(\) \{[\s\S]*?\n  \}\n\n  async function submitMessage/,
  `\n  async function submitMessage`,
  "remove manual rent action",
);
replaceOnce(
  web,
  '    if (!selected?.residenceId || !text || submitting) return;',
  '    if (!selected || !text || submitting) return;',
  "allow normal actions without housing",
);
replaceOnce(
  web,
  `            <h1>{selected?.residenceId ? world?.residence.name || "Unit 3B" : "Foundry Row"}</h1>\n            <p>\n              {selected?.residenceId\n                ? \`The apartment overlooks \${world?.alley.name || "the rear alley"}. The city moves beyond the walls.\`\n                : "Rain shines on old brick and machine shops. You have no base and no history here yet."}\n            </p>`,
  `            <h1>{selected?.residenceName || (selected ? "Ashdown Apartments" : "Foundry Row")}</h1>\n            <p>\n              {selected\n                ? \`Your unit is cramped, the locks are weak, and the empty floor space is limited. \${world?.alley.name || "The rear alley"} runs behind the building; Calder City offers much better places if you can earn them.\`\n                : "Rain shines on old brick and machine shops. You have no base and no history here yet."}\n            </p>`,
  "dynamic opening scene",
);
replaceRegex(
  web,
  /\n            \{selected && !selected\.residenceId && \([\s\S]*?\n            \)\}\n/,
  "\n",
  "remove shared Unit 3B card",
);
replaceOnce(
  web,
  '            {selected?.residenceId &&\n              timeline.length === 0 &&',
  '            {selected &&\n              timeline.length === 0 &&',
  "show action prompt without residence gate",
);
replaceOnce(
  web,
  ': "Install in Unit 3B"}',
  ': `Install in ${selected?.residenceName || "your apartment"}`}',
  "dynamic install label",
);
replaceOnce(
  web,
  '<dd>{selected.residenceId ? world?.residence.name || "Unit 3B" : "Foundry Row"}</dd>',
  '<dd>{selected.residenceName || "Foundry Row"}</dd>',
  "dynamic character location",
);
replaceOnce(
  web,
  '      {selected?.residenceId && (\n        <form className="scene-composer" onSubmit={submitMessage}>',
  '      {selected && (\n        <form className="scene-composer" onSubmit={submitMessage}>',
  "remove composer residence gate",
);

const mcpTools = "apps/mcp/src/tools.ts";
let toolsText = read(mcpTools);
toolsText = toolsText.replace(
  /Rent the seeded starter residence for a character\./g,
  "Ensure a character has a unique bare-bones starter apartment in Ashdown Apartments.",
);
write(mcpTools, toolsText);

const operationsDoc = "docs/operations/nocturne-mcp.md";
let operations = read(operationsDoc);
operations += `\n\n## Starter housing behavior\n\nCharacter creation atomically provisions a unique bare-bones unit inside Ashdown Apartments in Foundry Row. The building is shared geography, while every apartment is a distinct persistent residence instance. The legacy rent tool is retained as an idempotent repair operation and can no longer fail because another character occupies a different unit.\n`;
write(operationsDoc, operations);
