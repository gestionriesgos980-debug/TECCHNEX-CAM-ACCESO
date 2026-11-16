/**
 * TECCHNEX shared login rate limiter.
 * Upstash Redis REST; atomic sliding-window counters; server-side only.
 * Product namespace and hashed identifiers isolate products and avoid storing
 * raw post codes or IP addresses in Redis keys.
 */
export type LoginRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  post: { allowed: boolean; remaining: number };
  ip: { allowed: boolean; remaining: number };
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Options = {
  url: string;
  token: string;
  productCode: string;
  postLimit: number;
  ipLimit: number;
  windowSeconds: number;
  fetcher?: FetchLike;
  now?: () => number;
};

const LUA_SLIDING_WINDOW = [
  'local now = tonumber(ARGV[1])',
  'local window_ms = tonumber(ARGV[2])',
  'local max_requests = tonumber(ARGV[3])',
  'redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - window_ms)',
  'local count = redis.call("ZCARD", KEYS[1])',
  'if count >= max_requests then',
  '  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")',
  '  local retry_ms = math.max(1, tonumber(oldest[2]) + window_ms - now)',
  '  return {0, count, retry_ms}',
  'end',
  'redis.call("ZADD", KEYS[1], now, ARGV[4])',
  'redis.call("PEXPIRE", KEYS[1], window_ms)',
  'return {1, count + 1, 0}',
].join("\n");

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 100000;
}

async function keyedIdentifierHex(value: string, token: string): Promise<string> {
  // HMAC prevents offline guessing of low-entropy post codes if Redis keys leak.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class UpstashLoginRateLimiter {
  private readonly url: string;
  private readonly token: string;
  private readonly productCode: string;
  private readonly postLimit: number;
  private readonly ipLimit: number;
  private readonly windowSeconds: number;
  private readonly fetcher: FetchLike;
  private readonly now: () => number;

  constructor(options: Options) {
    const parsed = new URL(options.url);
    if (parsed.protocol !== "https:") throw new Error("RATE_LIMIT_URL_MUST_USE_HTTPS");
    if (!options.token || options.token.length < 16) throw new Error("RATE_LIMIT_TOKEN_INVALID");
    if (!/^[A-Z0-9_-]{2,40}$/.test(options.productCode)) throw new Error("RATE_LIMIT_PRODUCT_INVALID");
    if (!validLimit(options.postLimit) || !validLimit(options.ipLimit)) throw new Error("RATE_LIMIT_INVALID");
    if (!Number.isSafeInteger(options.windowSeconds) || options.windowSeconds < 1 || options.windowSeconds > 3600) {
      throw new Error("RATE_LIMIT_WINDOW_INVALID");
    }
    this.url = parsed.toString().replace(/\/$/, "");
    this.token = options.token;
    this.productCode = options.productCode;
    this.postLimit = options.postLimit;
    this.ipLimit = options.ipLimit;
    this.windowSeconds = options.windowSeconds;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async consume(postCode: string, clientIp: string): Promise<LoginRateLimitResult> {
    if (!postCode || postCode.length > 160 || !clientIp || clientIp.length > 100) {
      throw new Error("RATE_LIMIT_IDENTITY_INVALID");
    }
    const now = this.now();
    const windowMs = this.windowSeconds * 1000;
    const postHash = await keyedIdentifierHex(`${this.productCode}|POST|${postCode}`, this.token);
    const ipHash = await keyedIdentifierHex(`${this.productCode}|IP|${clientIp}`, this.token);
    const [postResult, ipResult] = await Promise.all([
      this.increment(`tecchnex:login-rate:v1:${this.productCode}:post:${postHash}`, now, windowMs, this.postLimit),
      this.increment(`tecchnex:login-rate:v1:${this.productCode}:ip:${ipHash}`, now, windowMs, this.ipLimit),
    ]);
    const postAllowed = postResult.allowed;
    const ipAllowed = ipResult.allowed;
    return {
      allowed: postAllowed && ipAllowed,
      retryAfterSeconds: postAllowed && ipAllowed ? 0 : Math.max(postResult.retryAfterSeconds, ipResult.retryAfterSeconds),
      post: { allowed: postAllowed, remaining: Math.max(0, this.postLimit - postResult.count) },
      ip: { allowed: ipAllowed, remaining: Math.max(0, this.ipLimit - ipResult.count) },
    };
  }

  private async increment(key: string, now: number, windowMs: number, limit: number): Promise<{ allowed: boolean; count: number; retryAfterSeconds: number }> {
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(["EVAL", LUA_SLIDING_WINDOW, "1", key, String(now), String(windowMs), String(limit), crypto.randomUUID()]),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`RATE_LIMIT_HTTP_${response.status}`);
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (payload && typeof payload.error === "string") throw new Error("RATE_LIMIT_REDIS_COMMAND_FAILED");
    if (!Array.isArray(payload?.result) || payload.result.length !== 3) throw new Error("RATE_LIMIT_RESPONSE_INVALID");
    const allowed = Number(payload.result[0]) === 1;
    const count = Number(payload.result[1]);
    const retryMs = Number(payload.result[2]);
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(retryMs) || retryMs < 0) throw new Error("RATE_LIMIT_COUNTER_INVALID");
    return { allowed, count, retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(retryMs / 1000)) };
  }
}

export function createLoginRateLimiterFromEnv(
  env: (name: string) => string | undefined,
  productCode: string,
  fetcher?: FetchLike,
): UpstashLoginRateLimiter {
  const url = env("UPSTASH_REDIS_REST_URL");
  const token = env("UPSTASH_REDIS_REST_TOKEN");
  const postLimit = Number(env(`${productCode}_RATE_LIMIT_POST`));
  const ipLimit = Number(env(`${productCode}_RATE_LIMIT_IP`));
  const windowSeconds = Number(env(`${productCode}_RATE_LIMIT_WINDOW_SECONDS`));
  if (!url || !token || !env(`${productCode}_RATE_LIMIT_POST`) || !env(`${productCode}_RATE_LIMIT_IP`) || !env(`${productCode}_RATE_LIMIT_WINDOW_SECONDS`)) {
    throw new Error("RATE_LIMIT_CONFIGURATION_INCOMPLETE");
  }
  return new UpstashLoginRateLimiter({ url, token, productCode, postLimit, ipLimit, windowSeconds, fetcher });
}
