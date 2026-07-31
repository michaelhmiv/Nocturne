#!/usr/bin/env node
/**
 * nocturne-agent CLI — official agent client.
 *
 * Env:
 *   NOCTURNE_API_URL / NOCTURNE_BASE_URL  (default http://localhost:3001)
 *   NOCTURNE_AGENT_TOKEN
 *   NOCTURNE_AGENT_BOOTSTRAP_KEY (optional)
 *   NOCTURNE_AGENT_CONFIG (~/.config/nocturne/agent.json)
 *
 * Commands:
 *   bootstrap [label]
 *   status | me | characters | rent | say <text> | history | market | vehicles
 *   create-character <name> <concept...>
 *   bind <characterId>
 *   buy <listingId>
 *   claim-vehicle <vehicleId>
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { NocturneAgent } from "@nocturne/agent-sdk";

type Config = { baseUrl: string; token?: string; label?: string };

function configPath() {
  return process.env.NOCTURNE_AGENT_CONFIG || join(homedir(), ".config", "nocturne", "agent.json");
}

function loadConfig(): Config {
  const path = configPath();
  let file: Config = { baseUrl: "http://localhost:3001" };
  if (existsSync(path)) {
    try {
      file = { ...file, ...JSON.parse(readFileSync(path, "utf8")) };
    } catch {
      /* ignore corrupt */
    }
  }
  return {
    baseUrl:
      process.env.NOCTURNE_API_URL ||
      process.env.NOCTURNE_BASE_URL ||
      file.baseUrl ||
      "http://localhost:3001",
    token: process.env.NOCTURNE_AGENT_TOKEN || file.token,
    label: file.label,
  };
}

function saveConfig(cfg: Config) {
  const path = configPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  console.error(`saved ${path}`);
}

function client() {
  const cfg = loadConfig();
  return {
    cfg,
    agent: new NocturneAgent({
      baseUrl: cfg.baseUrl,
      token: cfg.token,
      bootstrapKey: process.env.NOCTURNE_AGENT_BOOTSTRAP_KEY,
    }),
  };
}

function print(data: unknown) {
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "-h") {
    console.log(`nocturne-agent <command>

  bootstrap [label]          pair new agent token (saved to config)
  status                     character status (cash/heat/skills/inventory)
  me                         token identity
  characters                 list characters
  create-character <n> <c…>  create + bind character
  bind <characterId>
  rent                       rent starter unit
  say <text…>                freeform action (site chat equivalent)
  history
  market | buy <listingId>
  vehicles | claim-vehicle <id>
`);
    process.exit(0);
  }

  const { cfg, agent } = client();

  if (cmd === "bootstrap") {
    const label = rest[0] || "hermes";
    const result = await agent.bootstrap(label);
    saveConfig({ baseUrl: cfg.baseUrl, token: result.token, label: result.label });
    print({ ...result, token: result.token.slice(0, 16) + "…" });
    console.error("Full token saved to config (not re-printed fully above for safety).");
    // actually user needs full token once - print once
    console.log("TOKEN_ONCE=" + result.token);
    return;
  }

  if (!agent.token) {
    console.error("No token. Run: nocturne-agent bootstrap hermes");
    process.exit(1);
  }

  switch (cmd) {
    case "status":
      print(await agent.status());
      break;
    case "me":
      print(await agent.me());
      break;
    case "characters":
      print(await agent.listCharacters());
      break;
    case "create-character": {
      const name = rest[0];
      const concept = rest.slice(1).join(" ") || "A new arrival in Foundry Row.";
      if (!name) throw new Error("usage: create-character <name> <concept...>");
      print(await agent.createCharacter({ name, conceptSummary: concept, bind: true }));
      break;
    }
    case "bind":
      print(await agent.bind(rest[0] || null));
      break;
    case "rent":
      print(await agent.rent());
      break;
    case "say":
    case "act": {
      const text = rest.join(" ");
      if (!text) throw new Error("usage: say <text>");
      print(await agent.act(text));
      break;
    }
    case "history":
      print(await agent.history());
      break;
    case "market":
      print(await agent.market());
      break;
    case "buy":
      print(await agent.buy(rest[0]!));
      break;
    case "vehicles":
      print(await agent.vehicles());
      break;
    case "claim-vehicle":
      print(await agent.claimVehicle(rest[0]!));
      break;
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
