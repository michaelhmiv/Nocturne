/**
 * Official Nocturne Agent SDK — first-class client for external agents (Hermes, etc.).
 * Auth: Authorization: Bearer noct_agt_…
 */
export type AgentClientOptions = {
  baseUrl: string;
  token?: string;
  bootstrapKey?: string;
  fetchImpl?: typeof fetch;
};

export class NocturneAgentError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message?: string,
  ) {
    super(message || `Nocturne agent HTTP ${status}`);
    this.name = "NocturneAgentError";
  }
}

export class NocturneAgent {
  readonly baseUrl: string;
  token: string | null;
  private bootstrapKey?: string;
  private fetchImpl: typeof fetch;

  constructor(opts: AgentClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token || null;
    this.bootstrapKey = opts.bootstrapKey;
    this.fetchImpl = opts.fetchImpl || fetch.bind(globalThis);
  }

  private headers(extra?: Record<string, string>) {
    return {
      "content-type": "application/json",
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(extraHeaders),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) {
      throw new NocturneAgentError(
        res.status,
        data,
        (data && (data.message || data.error)) || `HTTP ${res.status}`,
      );
    }
    return data as T;
  }

  /** Pair a new isolated agent identity. Returns plaintext token once. */
  async bootstrap(label = "agent") {
    const headers: Record<string, string> = {};
    if (this.bootstrapKey) headers["x-nocturne-bootstrap-key"] = this.bootstrapKey;
    const result = await this.request<{
      token: string;
      tokenId: string;
      userId: string;
      label: string;
    }>("POST", "/v1/agent/bootstrap", { label }, headers);
    this.token = result.token;
    return result;
  }

  me() {
    return this.request<Record<string, unknown>>("GET", "/v1/agent/me");
  }

  status() {
    return this.request<Record<string, unknown>>("GET", "/v1/agent/status");
  }

  createCharacter(input: { name: string; conceptSummary: string; bind?: boolean }) {
    return this.request("POST", "/v1/agent/characters", input);
  }

  listCharacters() {
    return this.request<{ characters: unknown[] }>("GET", "/v1/agent/characters");
  }

  bind(characterId: string | null) {
    return this.request("POST", "/v1/agent/bind", { characterId });
  }

  rent(characterId?: string) {
    return this.request("POST", "/v1/agent/rent", characterId ? { characterId } : {});
  }

  /** Freeform act — same as typing in the site chat (action path). */
  act(text: string, characterId?: string) {
    return this.request("POST", "/v1/agent/act", {
      text,
      ...(characterId ? { characterId } : {}),
    });
  }

  history(characterId?: string) {
    const q = characterId ? `?characterId=${encodeURIComponent(characterId)}` : "";
    return this.request("GET", `/v1/agent/history${q}`);
  }

  market() {
    return this.request("GET", "/v1/agent/market");
  }

  buy(listingId: string, characterId?: string) {
    return this.request("POST", "/v1/agent/market/buy", {
      listingId,
      ...(characterId ? { characterId } : {}),
    });
  }

  vehicles() {
    return this.request("GET", "/v1/agent/vehicles");
  }

  claimVehicle(vehicleId: string, characterId?: string) {
    return this.request("POST", "/v1/agent/vehicles/claim", {
      vehicleId,
      ...(characterId ? { characterId } : {}),
    });
  }
}
