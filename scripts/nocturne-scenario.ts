import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseOptions, sendMessage, type CliOptions } from "./nocturne-cli.js";

type ScenarioTurn = {
  message: string;
  idempotencyKey?: string;
  assert?: Record<string, unknown>;
  includes?: Record<string, string>;
};

function atPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (current === null || typeof current !== "object" || !(part in current))
      throw new Error(`Missing assertion path: ${path}`);
    return (current as Record<string, unknown>)[part];
  }, value);
}

function parseTurn(line: string, lineNumber: number): ScenarioTurn {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error(`Scenario line ${lineNumber} is not valid JSON`);
  }
  if (!value || typeof value !== "object" || !("message" in value))
    throw new Error(`Scenario line ${lineNumber} requires a message`);
  const turn = value as ScenarioTurn;
  if (typeof turn.message !== "string" || !turn.message.trim())
    throw new Error(`Scenario line ${lineNumber} requires a non-empty message`);
  for (const field of ["assert", "includes"] as const) {
    if (
      turn[field] !== undefined &&
      (!turn[field] || typeof turn[field] !== "object" || Array.isArray(turn[field]))
    )
      throw new Error(`Scenario line ${lineNumber} ${field} must be an object`);
  }
  return turn;
}

export async function runScenario(
  lines: Iterable<string> | AsyncIterable<string>,
  options: CliOptions,
  output: (line: string) => void = console.log,
) {
  let turnNumber = 0;
  let lineNumber = 0;
  for await (const rawLine of lines) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const turn = parseTurn(line, lineNumber);
    turnNumber += 1;
    const response = await sendMessage(
      options,
      turn.message,
      turn.idempotencyKey || `${options.idempotencyKey}-${turnNumber}`,
    );
    for (const [path, expected] of Object.entries(turn.assert || {})) {
      const actual = atPath(response, path);
      if (!isDeepStrictEqual(actual, expected))
        throw new Error(
          `Scenario line ${lineNumber} assertion ${path} failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
    }
    for (const [path, expected] of Object.entries(turn.includes || {})) {
      const actual = atPath(response, path);
      if (typeof actual !== "string" || !actual.includes(expected))
        throw new Error(
          `Scenario line ${lineNumber} assertion ${path} failed: ${JSON.stringify(actual)} does not include ${JSON.stringify(expected)}`,
        );
    }
    output(JSON.stringify(response));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  let file = process.env.NOCTURNE_SCENARIO;
  if (fileIndex >= 0) {
    file = args[fileIndex + 1];
    if (!file) throw new Error("--file requires a value");
    args.splice(fileIndex, 2);
  }
  const options = parseOptions(args);
  if (file) {
    await runScenario((await readFile(file, "utf8")).split(/\r?\n/), options);
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    await runScenario(Buffer.concat(chunks).toString("utf8").split(/\r?\n/), options);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
