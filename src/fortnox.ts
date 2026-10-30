import { promises as fs } from "node:fs";
import path from "node:path";

const API_BASE = "https://api.fortnox.se/3";
const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";

interface StoredTokens {
  refresh_token: string;
  access_token?: string;
  expires_at?: number;
}

export class FortnoxClient {
  private tokens: StoredTokens | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tokenFile: string,
    private readonly bootstrapRefreshToken?: string,
  ) {}

  private async loadTokens(): Promise<StoredTokens> {
    if (this.tokens) return this.tokens;
    try {
      const raw = await fs.readFile(this.tokenFile, "utf8");
      this.tokens = JSON.parse(raw) as StoredTokens;
    } catch {
      if (!this.bootstrapRefreshToken) {
        throw new Error(
          "No Fortnox refresh token found. Set FORTNOX_REFRESH_TOKEN for the first start.",
        );
      }
      this.tokens = { refresh_token: this.bootstrapRefreshToken };
    }
    return this.tokens;
  }

  private async saveTokens(tokens: StoredTokens): Promise<void> {
    this.tokens = tokens;
    await fs.mkdir(path.dirname(this.tokenFile), { recursive: true });
    await fs.writeFile(this.tokenFile, JSON.stringify(tokens), { mode: 0o600 });
  }

  private async getAccessToken(): Promise<string> {
    const tokens = await this.loadTokens();
    if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 60_000) {
      return tokens.access_token;
    }

    // Fortnox rotates refresh tokens: each refresh returns a new one that must be saved.
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }),
    });
    if (!res.ok) {
      throw new Error(`Fortnox token refresh failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    await this.saveTokens({
      refresh_token: data.refresh_token,
      access_token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });
    return data.access_token;
  }

  async get(endpoint: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const url = new URL(`${API_BASE}${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`Fortnox GET ${endpoint} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }
}
