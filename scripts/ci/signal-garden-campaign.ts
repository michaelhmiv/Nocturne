import { ACTION_TYPES, type ActionType } from "../../packages/rules-engine/src/actions.js";
import { ACTION_CAPABILITIES } from "../../test/capabilities/action-capabilities.js";

export const SIGNAL_GARDEN_TITLE = "Signal Garden";
export const SIGNAL_GARDEN_DEFAULT_SEED = "signal-garden-2026-09-22";
export const SIGNAL_GARDEN_TURN_COUNT = 5_000;
export const SIGNAL_GARDEN_SIGNATURE_ACTION = "relay_public_signal";

const PLAYERS = ["mara", "dax", "imani"] as const;
const ROLES = ["receiver", "runner", "witness"] as const;
const WITNESSES = [
  "the night-shift porter",
  "the laundromat owner",
  "the bridge electrician",
  "the market courier",
  "the library archivist",
  "the bus mechanic",
  "the apartment superintendent",
] as const;
const PUBLIC_TRAILS = [
  "a stamped kiosk receipt",
  "a timestamped radio burst",
  "a witness ledger entry",
  "a public notice revision",
  "a route-board checksum",
  "a signed maintenance ticket",
] as const;
const PHASES = ["seed", "trace", "relay", "counter-signal", "public-record"] as const;

export type SignalGardenPhase = (typeof PHASES)[number];
export type SignalGardenPlayer = (typeof PLAYERS)[number];
export type SignalGardenRole = (typeof ROLES)[number];

export interface SignalGardenTurn {
  sequence: number;
  chapter: number;
  beat: number;
  phase: SignalGardenPhase;
  playerAlias: SignalGardenPlayer;
  role: SignalGardenRole;
  actionType: ActionType;
  expectedWorldKind:
    | "search"
    | "move"
    | "consume"
    | "relationship"
    | "combat"
    | "transfer"
    | "interact"
    | "dialogue";
  packetId: string;
  witness: string;
  checksum: string;
  publicTrail: string;
  signatureAction: boolean;
  command: string;
}

export interface SignalPacketState {
  status: "seeded" | "queued" | "published" | "blocked";
  witness: string;
  checksum: string;
  relayCount: number;
  lastTurn: number;
}

export interface SignalGardenState {
  version: number;
  completedTurns: number;
  waitingTurns: number;
  blockedTurns: number;
  relayCount: number;
  publicTrust: number;
  packets: Record<string, SignalPacketState>;
}

export interface SignalGardenExecution {
  state: "completed" | "waiting" | "waiting_for_clarification";
  eventIds: string[];
}

function hashSeed(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function pick<T>(values: readonly T[], seed: string, sequence: number, salt: string) {
  return values[hashSeed(seed + ":" + sequence + ":" + salt) % values.length]!;
}

function shortSeed(seed: string) {
  const value = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return (value || "campaign").slice(0, 24);
}

export function expectedWorldKind(actionType: ActionType): SignalGardenTurn["expectedWorldKind"] {
  if ((["detect", "search", "observe"] as readonly string[]).includes(actionType)) return "search";
  if ((["move", "drive"] as readonly string[]).includes(actionType)) return "move";
  if (actionType === "consume") return "consume";
  if ((["bribe", "persuade", "threaten"] as readonly string[]).includes(actionType))
    return "relationship";
  if ((["attack", "arrest"] as readonly string[]).includes(actionType)) return "combat";
  if ((["steal", "buy", "sell"] as readonly string[]).includes(actionType)) return "transfer";
  if (actionType === "talk") return "dialogue";
  return "interact";
}

export function createSignalGardenTurn(
  sequence: number,
  seed = SIGNAL_GARDEN_DEFAULT_SEED,
): SignalGardenTurn {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error("Signal Garden sequence must be a non-negative integer.");
  }
  const actionType = ACTION_TYPES[sequence % ACTION_TYPES.length] as ActionType;
  const capability = ACTION_CAPABILITIES[actionType];
  const chapter = Math.floor(sequence / ACTION_TYPES.length) + 1;
  const beat = (sequence % ACTION_TYPES.length) + 1;
  const phase = PHASES[Math.floor((beat - 1) / 5)]!;
  const packetId =
    "SG-" +
    shortSeed(seed) +
    "-" +
    String(chapter).padStart(3, "0") +
    "-" +
    String(beat).padStart(2, "0");
  const checksum = hashSeed(seed + ":checksum:" + packetId)
    .toString(16)
    .padStart(8, "0");
  const witness = pick(WITNESSES, seed, sequence, "witness");
  const publicTrail = pick(PUBLIC_TRAILS, seed, sequence, "trail");
  const playerAlias = PLAYERS[(sequence + hashSeed(seed)) % PLAYERS.length]!;
  const role = ROLES[sequence % ROLES.length]!;
  const signatureAction = actionType === "hack";

  const command = signatureAction
    ? "Hack the Signal Garden relay kiosk to publish packet " +
      packetId +
      " for " +
      witness +
      " after verifying checksum " +
      checksum +
      " and leave an auditable public evidence trail."
    : String(capability.canonicalPrompts[sequence % capability.canonicalPrompts.length]).replace(
        /[.!?]+$/,
        "",
      ) +
      " for packet " +
      packetId +
      " during the " +
      phase +
      " phase as the " +
      role +
      " using " +
      publicTrail +
      ".";

  return {
    sequence,
    chapter,
    beat,
    phase,
    playerAlias,
    role,
    actionType,
    expectedWorldKind: expectedWorldKind(actionType),
    packetId,
    witness,
    checksum,
    publicTrail,
    signatureAction,
    command,
  };
}

export function generateSignalGardenCampaign(input?: {
  turns?: number;
  seed?: string;
}): SignalGardenTurn[] {
  const turns = input?.turns ?? SIGNAL_GARDEN_TURN_COUNT;
  const seed = input?.seed ?? SIGNAL_GARDEN_DEFAULT_SEED;
  if (!Number.isInteger(turns) || turns < 1 || turns > 100_000) {
    throw new Error("Signal Garden turn count must be between 1 and 100000.");
  }
  if (!seed.trim()) throw new Error("Signal Garden seed must not be empty.");
  return Array.from({ length: turns }, (_, sequence) => createSignalGardenTurn(sequence, seed));
}

export function createInitialSignalGardenState(): SignalGardenState {
  return {
    version: 0,
    completedTurns: 0,
    waitingTurns: 0,
    blockedTurns: 0,
    relayCount: 0,
    publicTrust: 0,
    packets: {},
  };
}

export function applySignalGardenTurn(
  state: SignalGardenState,
  turn: SignalGardenTurn,
  execution: SignalGardenExecution,
): SignalGardenState {
  if (turn.sequence !== state.version) {
    throw new Error(
      "Signal Garden state machine expected turn " +
        state.version +
        " but received " +
        turn.sequence +
        ".",
    );
  }

  const packet = state.packets[turn.packetId] || {
    status: "seeded" as const,
    witness: turn.witness,
    checksum: turn.checksum,
    relayCount: 0,
    lastTurn: -1,
  };
  const nextPacket: SignalPacketState = { ...packet, lastTurn: turn.sequence };
  const next = {
    ...state,
    version: state.version + 1,
    packets: { ...state.packets, [turn.packetId]: nextPacket },
  };

  if (execution.state === "completed") {
    next.completedTurns += 1;
    if (turn.signatureAction) {
      nextPacket.status = "published";
      nextPacket.relayCount += 1;
      next.relayCount += 1;
      next.publicTrust += 2;
    } else {
      next.publicTrust += turn.phase === "public-record" ? 1 : 0;
    }
  } else if (execution.state === "waiting") {
    next.waitingTurns += 1;
    nextPacket.status = "queued";
  } else {
    next.blockedTurns += 1;
    nextPacket.status = "blocked";
  }

  return next;
}

export function auditSignalGardenCampaign(turns: readonly SignalGardenTurn[]) {
  const actionCounts = new Map<ActionType, number>();
  const players = new Set<string>();
  const packets = new Set<string>();
  const commands = new Set<string>();
  const signatureTurns: number[] = [];
  const errors: string[] = [];

  turns.forEach((turn, index) => {
    if (turn.sequence !== index) errors.push("sequence_gap:" + index);
    if (packets.has(turn.packetId)) errors.push("duplicate_packet:" + turn.packetId);
    if (commands.has(turn.command)) errors.push("duplicate_command:" + turn.sequence);
    packets.add(turn.packetId);
    commands.add(turn.command);
    players.add(turn.playerAlias);
    actionCounts.set(turn.actionType, (actionCounts.get(turn.actionType) || 0) + 1);
    if (turn.signatureAction) signatureTurns.push(turn.sequence);
    if (turn.signatureAction && turn.actionType !== "hack") {
      errors.push("signature_not_hack:" + turn.sequence);
    }
  });

  for (const actionType of ACTION_TYPES) {
    if (!actionCounts.has(actionType)) errors.push("missing_action:" + actionType);
  }
  for (const player of PLAYERS) {
    if (!players.has(player)) errors.push("missing_player:" + player);
  }

  return {
    errors,
    actionCounts: Object.fromEntries(actionCounts),
    playerCount: players.size,
    packetCount: packets.size,
    commandCount: commands.size,
    signatureTurns,
  };
}

export const SIGNAL_GARDEN_PLAYERS = PLAYERS;
export const SIGNAL_GARDEN_PHASES = PHASES;
