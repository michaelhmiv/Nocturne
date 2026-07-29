import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

export type CliOptions = {
  baseUrl: string;
  conversationId: string;
  cookie?: string;
  guest: boolean;
  idempotencyKey: string;
};

type ConversationResponse = {
  responseId: string;
  narration: string;
  plan: {
    checks: {
      order: number;
      label: string;
      publicFactors: {
        summary: string;
        probabilityDeltaBasisPoints: number;
      }[];
    }[];
  };
  execution: { state: string; stoppedAfterOrder?: number };
  outcomes: {
    order: number;
    finalProbability: { basisPoints: number };
    rollBasisPoints: number | null;
    grade: string;
    summary: string;
  }[];
};

function value(args: string[], index: number, name: string) {
  const result = args[index + 1];
  if (!result || result.startsWith("--")) throw new Error(`${name} requires a value`);
  return result;
}

export function parseOptions(
  args = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): CliOptions {
  const options: CliOptions = {
    baseUrl: env.NOCTURNE_BASE_URL || "http://localhost:3001",
    conversationId: env.NOCTURNE_CONVERSATION_ID || randomUUID(),
    cookie: env.NOCTURNE_COOKIE,
    guest: env.NOCTURNE_GUEST_MODE === "1" || env.NOCTURNE_GUEST_MODE === "true",
    idempotencyKey: env.NOCTURNE_IDEMPOTENCY_KEY || randomUUID(),
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") continue;
    if (arg === "--guest") options.guest = true;
    else if (arg === "--base-url") options.baseUrl = value(args, index++, arg);
    else if (arg === "--conversation-id") options.conversationId = value(args, index++, arg);
    else if (arg === "--cookie") options.cookie = value(args, index++, arg);
    else if (arg === "--idempotency-key") options.idempotencyKey = value(args, index++, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const url = new URL(options.baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Base URL must use http or https");
  options.baseUrl = options.baseUrl.replace(/\/$/, "");
  if (!options.conversationId.trim()) throw new Error("Conversation ID cannot be empty");
  return options;
}

function headers(options: CliOptions, idempotencyKey?: string) {
  return {
    "content-type": "application/json",
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.guest ? { "x-nocturne-guest-mode": "1" } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  };
}

async function request(
  options: CliOptions,
  method: string,
  idempotencyKey?: string,
  message?: string,
) {
  const response = await fetch(
    `${options.baseUrl}/v1/conversations/${encodeURIComponent(options.conversationId)}/messages`,
    {
      method,
      headers: headers(options, idempotencyKey),
      ...(message === undefined ? {} : { body: JSON.stringify({ message }) }),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : JSON.stringify(body);
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return body;
}

export async function sendMessage(
  options: CliOptions,
  message: string,
  idempotencyKey: string,
): Promise<ConversationResponse> {
  return (await request(options, "POST", idempotencyKey, message)) as ConversationResponse;
}

export async function getHistory(options: CliOptions) {
  return request(options, "GET");
}

const percent = (basisPoints: number) => `${(basisPoints / 100).toFixed(2)}% (${basisPoints} bp)`;

export function formatConversation(response: ConversationResponse) {
  const lines = [response.narration];
  for (const outcome of response.outcomes) {
    const check = response.plan.checks.find(({ order }) => order === outcome.order);
    lines.push(
      `${check?.label || `Check ${outcome.order}`} — probability ${percent(outcome.finalProbability.basisPoints)}, roll ${outcome.rollBasisPoints === null ? "not required" : percent(outcome.rollBasisPoints)}, ${outcome.grade}`,
    );
    for (const factor of check?.publicFactors || []) {
      const delta = factor.probabilityDeltaBasisPoints;
      lines.push(`  factor ${delta >= 0 ? "+" : ""}${delta} bp: ${factor.summary}`);
    }
    lines.push(`  ${outcome.summary}`);
  }
  lines.push(
    `execution: ${response.execution.state}${response.execution.stoppedAfterOrder ? ` after check ${response.execution.stoppedAfterOrder}` : ""}`,
    `event: ${response.responseId}`,
  );
  return lines.join("\n");
}

function isLocal(baseUrl: string) {
  return ["localhost", "127.0.0.1", "::1"].includes(new URL(baseUrl).hostname);
}

async function main() {
  const options = parseOptions();
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });
  console.log(
    `Nocturne conversation ${options.conversationId}. /quit exits; /history inspects local player-safe history.`,
  );
  let turn = 0;
  for (;;) {
    const message = (await terminal.question("> ")).trim();
    if (!message) continue;
    if (message === "/quit") break;
    try {
      if (message === "/history") {
        if (!isLocal(options.baseUrl))
          throw new Error("/history is available only against a local API");
        console.log(JSON.stringify(await getHistory(options), null, 2));
      } else {
        turn += 1;
        console.log(
          formatConversation(
            await sendMessage(options, message, `${options.idempotencyKey}-${turn}`),
          ),
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  }
  terminal.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
