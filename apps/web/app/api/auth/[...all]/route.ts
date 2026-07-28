import { getAuthFromEnv } from "@nocturne/auth";

export async function GET(request: Request) {
  return getAuthFromEnv().handler(request);
}

export async function POST(request: Request) {
  return getAuthFromEnv().handler(request);
}
