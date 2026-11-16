// Validador aislado para el formato emitido por cam-acceso-post-authorize.
const enc = new TextEncoder();
const b64url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const fromB64url = (part) => {
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};
const decodePart = (part) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromB64url(part)));

export async function verifySessionToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 8192 || typeof secret !== 'string' || secret.length < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !p || !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  let header, claims, signature;
  try {
    header = decodePart(parts[0]);
    claims = decodePart(parts[1]);
    signature = fromB64url(parts[2]);
  } catch { return null; }
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT' || !claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
  if (signature.length !== 32) return null;
  try {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, signature, enc.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
  } catch { return null; }
  if (claims.iss !== 'tecchnex-cam-acceso' || claims.aud !== 'CAM-ACCESO') return null;
  if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.client_id !== 'string' || !claims.client_id || typeof claims.client_product_id !== 'string' || !claims.client_product_id) return null;
  if (!['Vigilante', 'Supervisor', 'Administrador TIC'].includes(claims.role)) return null;
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= nowSeconds || claims.iat > nowSeconds + 30 || claims.exp <= claims.iat || claims.exp - claims.iat > 900) return null;
  if (typeof claims.jti !== 'string' || !claims.jti) return null;
  return claims;
}

// Helper de prueba; NO usar para emitir tokens en producción.
export async function signTestToken(claims, secret) {
  const part = (value) => b64url(enc.encode(JSON.stringify(value)));
  const header = part({ alg: 'HS256', typ: 'JWT' });
  const body = part(claims);
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`)));
  return `${header}.${body}.${b64url(sig)}`;
}
