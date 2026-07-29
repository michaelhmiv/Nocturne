import { createHmac } from "node:crypto";
import {
  MAX_CONVERSATION_CHECKS,
  NocturneProbabilitySchema,
  outcomeGradeForMarginBasisPoints,
  type OutcomeGrade,
} from "@nocturne/contracts";

export type ProbabilityCheckKind = "primary_action" | "hidden_reaction";
export type ProbabilityHmacSource = (secret: string | Buffer, message: string) => Buffer;
export type NocturneProbability = ReturnType<typeof NocturneProbabilitySchema.parse>;

export interface ProbabilityCheckInput {
  serverSecret: string | Buffer;
  eventId: string;
  checkOrder: number;
  checkKind: ProbabilityCheckKind;
  authoritativeProbability: unknown;
  hmacSource?: ProbabilityHmacSource;
}

export interface ProbabilityCheckResult {
  success: boolean;
  rollBasisPoints: number | null;
  marginBasisPoints: number | null;
  outcomeGrade: OutcomeGrade;
}

const domains: Record<ProbabilityCheckKind, string> = {
  primary_action: "nocturne:probability:v1:primary-action",
  hidden_reaction: "nocturne:probability:v1:hidden-reaction",
};
const UINT32_RANGE = 0x1_0000_0000;
const REJECTION_LIMIT = Math.floor(UINT32_RANGE / 10_000) * 10_000;
const defaultHmacSource: ProbabilityHmacSource = (secret, message) =>
  createHmac("sha256", secret).update(message).digest();

export function validateNocturneProbability(value: unknown): NocturneProbability {
  const parsed = NocturneProbabilitySchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid probability.");
  return parsed.data;
}

export function resolveProbabilityCheck(input: ProbabilityCheckInput): ProbabilityCheckResult {
  const probability = validateNocturneProbability(input.authoritativeProbability);
  const domain = domains[input.checkKind];
  if (
    (typeof input.serverSecret !== "string" && !Buffer.isBuffer(input.serverSecret)) ||
    input.serverSecret.length === 0 ||
    !input.eventId.trim() ||
    input.eventId.length > 128 ||
    !Number.isInteger(input.checkOrder) ||
    input.checkOrder < 1 ||
    input.checkOrder > MAX_CONVERSATION_CHECKS ||
    !domain
  ) {
    throw new Error("Invalid probability check identity.");
  }

  if (probability.basisPoints === 0)
    return {
      success: false,
      rollBasisPoints: null,
      marginBasisPoints: null,
      outcomeGrade: "failure",
    };
  if (probability.basisPoints === 10_000)
    return {
      success: true,
      rollBasisPoints: null,
      marginBasisPoints: null,
      outcomeGrade: "complete_success",
    };

  const hmac = input.hmacSource ?? defaultHmacSource;
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const bytes = hmac(
      input.serverSecret,
      JSON.stringify([domain, input.eventId, input.checkOrder, attempt]),
    );
    if (!Buffer.isBuffer(bytes) || bytes.length < 4)
      throw new Error("Invalid probability HMAC source.");
    const sample = bytes.readUInt32BE(0);
    if (sample < REJECTION_LIMIT) {
      const rollBasisPoints = (sample % 10_000) + 1;
      const marginBasisPoints = probability.basisPoints - rollBasisPoints;
      return {
        success: marginBasisPoints >= 0,
        rollBasisPoints,
        marginBasisPoints,
        outcomeGrade: outcomeGradeForMarginBasisPoints(marginBasisPoints),
      };
    }
  }
  throw new Error("Probability rejection sampling exhausted.");
}
