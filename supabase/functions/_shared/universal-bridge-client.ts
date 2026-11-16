/**
 * Cliente servidor-a-servidor del TECCHNEX Universal Bridge.
 * Solo Edge Functions: nunca importar desde HTML/JavaScript de navegador.
 * Identidad POST: el UUID del puesto no se convierte en usuario individual.
 */
export type CentralBridgeResult = {
  authorized: boolean;
  code: string;
  valid_from?: string | null;
  valid_until?: string | null;
};

type BridgeRequest = {
  version: "1";
  request_id: string;
  project_code: "CAM-ACCESO";
  product_code: "CAM-ACCESO";
  identity_type: "POST";
  external_post_id: string;
  external_client_id: string;
  issued_at: string;
};

export function canonicalBridgePayload(r: BridgeRequest): string {
  return [r.version, r.request_id.toLowerCase(), r.project_code, r.product_code,
    "POST", r.external_post_id.toLowerCase(), r.external_client_id.toLowerCase(), r.issued_at].join("\n");
}

export async function signBridgePayload(r: BridgeRequest, secret: string): Promise<string> {
  if (secret.length < 32) throw new Error("BRIDGE_SECRET_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalBridgePayload(r)));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function authorizeCentralCommercial(args: {
  postId: string; clientId: string; fetcher?: typeof fetch;
}): Promise<CentralBridgeResult> {
  const endpoint = Deno.env.get("CENTRAL_UNIVERSAL_AUTHORIZE_URL")
    ?? Deno.env.get("CENTRAL_BRIDGE_URL") ?? "";
  // This product uses its own project HMAC key.
  const secret = Deno.env.get("CAM_ACCESO_PROJECT_HMAC_SECRET") ?? "";
  if (!endpoint || secret.length < 32) return { authorized: false, code: "CENTRAL_BRIDGE_NOT_CONFIGURED" };
  if (!args.postId || !args.clientId) return { authorized: false, code: "CENTRAL_BRIDGE_IDENTITY_INCOMPLETE" };
  const request: BridgeRequest = {
    version: "1", request_id: crypto.randomUUID(), project_code: "CAM-ACCESO",
    product_code: "CAM-ACCESO", identity_type: "POST", external_post_id: args.postId,
    external_client_id: args.clientId, issued_at: new Date().toISOString(),
  };
  try {
    const signature = await signBridgePayload(request, secret);
    const response = await (args.fetcher ?? fetch)(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", "x-tecchnex-signature": signature },
      body: JSON.stringify(request), signal: AbortSignal.timeout(8000),
    });
    let result: Record<string, unknown>;
    try { result = await response.json(); }
    catch { return { authorized: false, code: "CENTRAL_RESPONSE_INVALID" }; }
    if (!response.ok || result.authorized !== true || result.code !== "AUTHORIZED") {
      return { authorized: false, code: typeof result.code === "string" ? result.code : "CENTRAL_AUTHORIZATION_DENIED" };
    }
    if (result.product_code !== "CAM-ACCESO") return { authorized: false, code: "CENTRAL_PRODUCT_MISMATCH" };
    return { authorized: true, code: "AUTHORIZED",
      valid_from: typeof result.valid_from === "string" ? result.valid_from : null,
      valid_until: typeof result.valid_until === "string" ? result.valid_until : null };
  } catch { return { authorized: false, code: "CENTRAL_AUTHORIZATION_UNAVAILABLE" }; }
}

const CENTRAL_UNAVAILABLE_CODES = new Set([
  "CENTRAL_BRIDGE_NOT_CONFIGURED", "CENTRAL_BRIDGE_IDENTITY_INCOMPLETE",
  "CENTRAL_AUTHORIZATION_UNAVAILABLE", "CENTRAL_RESPONSE_INVALID",
  "POST_COMMERCIAL_LOOKUP_FAILED", "POST_COMMERCIAL_PROVIDER_UNAVAILABLE",
  "POST_COMMERCIAL_EVALUATION_FAILED", "REPLAY_GUARD_FAILED",
  "PERSISTENT_REPLAY_PROTECTION_REQUIRED", "REPLAY_GUARD_UNAVAILABLE",
  "SERVER_CONFIGURATION_INCOMPLETE", "SIGNATURE_VERIFICATION_FAILED",
  "SIGNING_SECRET_UNAVAILABLE", "RATE_LIMIT_SERVICE_UNAVAILABLE",
]);
export function isCentralAuthorizationUnavailable(code: string): boolean {
  return CENTRAL_UNAVAILABLE_CODES.has(code);
}
