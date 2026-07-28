import { getAuthFromEnv } from "@nocturne/auth";
import { toNextJsHandler } from "better-auth/next-js";

export function GET(request: Request) {
  return toNextJsHandler(getAuthFromEnv()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getAuthFromEnv()).POST(request);
}
