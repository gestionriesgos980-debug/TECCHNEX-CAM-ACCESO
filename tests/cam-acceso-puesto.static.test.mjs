// CAM-ACCESO-PUESTO-01 — pruebas locales estáticas y del token. No tocan Supabase ni la red.
// Ejecutar desde la raíz del paquete:  node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifySessionToken, signTestToken } from "../supabase/functions/cam-acceso-session-validate/token.mjs";

const F = "supabase/functions/";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const authorize = read(F + "cam-acceso-post-authorize/index.ts");
const validate = read(F + "cam-acceso-session-validate/index.ts");
const admin = read(F + "cam-acceso-post-admin/index.ts");
const token = read(F + "cam-acceso-session-validate/token.mjs");
const bridge = read(F + "_shared/universal-bridge-client.ts");

const SECRET = "x".repeat(40);
const now = Math.floor(Date.now() / 1000);
const claims = (o = {}) => ({ iss: "tecchnex-cam-acceso", aud: "CAM-ACCESO", sub: "p1", client_id: "c1",
  client_product_id: "k1", role: "Vigilante", iat: now, exp: now + 600, jti: "j1", ...o });

test("aislamiento: ninguna copia nombra CAM-RONDAS en código ejecutable", () => {
  for (const t of [authorize, validate, admin, token, bridge]) {
    const code = t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.doesNotMatch(code, /CAM-RONDAS|CAM_RONDAS|cam-rondas/i);
  }
});
test("usa Universal Bridge POST con identidad de puesto, sin convertirla en usuario", () => {
  for (const t of [authorize, validate]) assert.match(t, /authorizeCentralCommercial\(\{postId:String\(/);
  assert.match(bridge, /identity_type: "POST"/);
  assert.match(bridge, /external_post_id: args\.postId/);
  assert.match(bridge, /Deno\.env\.get\("CAM_ACCESO_PROJECT_HMAC_SECRET"\)/);
  assert.doesNotMatch(bridge, /BRIDGE_PROJECT_HMAC_SECRET|CENTRAL_BRIDGE_SECRET/);
  assert.match(bridge, /project_code: "CAM-ACCESO"/);
  assert.match(bridge, /product_code: "CAM-ACCESO"/);
  assert.doesNotMatch(bridge, /CAM-RONDAS|CAM_RONDAS/i);
});
test("producto fijo CAM-ACCESO y secreto de sesión propio", () => {
  assert.match(authorize, /"CAM-ACCESO"/);
  assert.match(authorize, /CAM_ACCESO_SESSION_HMAC_SECRET/);
  assert.match(validate, /CAM_ACCESO_SESSION_HMAC_SECRET/);
  assert.match(authorize, /createLoginRateLimiterFromEnv\(.*"CAM_ACCESO"\)/);
});
test("el ingreso falla cerrado sin IP confiable ni limitador", () => {
  assert.match(authorize, /RATE_LIMIT_CLIENT_IP_UNAVAILABLE/);
  assert.match(authorize, /RATE_LIMIT_SERVICE_UNAVAILABLE/);
});
test("el ingreso exige que haya exactamente un puesto y contrato vigente", () => {
  assert.match(authorize, /rows\.length!==1/);
  assert.match(authorize, /isCommercialEntitlementCurrent/);
  assert.match(authorize, /"CAM-ACCESO",today/);
});
test("administración: verifica código único en todo el producto antes de crear", () => {
  assert.match(admin, /post duplicate check failed/);
  assert.match(admin, /contract\.product\.code","CAM-ACCESO"/);
  assert.ok(admin.indexOf("dup&&dup.length>0") < admin.indexOf("bcrypt.hash(password,12)"));
});
test("administración conserva MFA AAL2, perfil admin_tecchnex y rotación/estado", () => {
  assert.match(admin, /aal2/i);
  assert.match(admin, /admin_tecchnex/);
  for (const a of ["list", "create", "rotate_password", "set_status"]) assert.match(admin, new RegExp(`action===\"${a}\"`));
});
test("ningún archivo contiene claves ni secretos escritos", () => {
  for (const t of [authorize, validate, admin, token]) {
    assert.doesNotMatch(t, /sb_secret_|eyJ[A-Za-z0-9_-]{20,}\./);
  }
});
test("token: acepta uno válido de CAM-ACCESO", async () => {
  const c = await verifySessionToken(await signTestToken(claims(), SECRET), SECRET);
  assert.equal(c.aud, "CAM-ACCESO");
});
test("token: rechaza uno emitido para CAM-RONDAS", async () => {
  const t = await signTestToken(claims({ iss: "tecchnex-cam-rondas", aud: "CAM-RONDAS" }), SECRET);
  assert.equal(await verifySessionToken(t, SECRET), null);
});
test("token: rechaza vencido, rol inválido, firma alterada y secreto corto", async () => {
  assert.equal(await verifySessionToken(await signTestToken(claims({ exp: now - 5, iat: now - 600 }), SECRET), SECRET), null);
  assert.equal(await verifySessionToken(await signTestToken(claims({ role: "Admin" }), SECRET), SECRET), null);
  const good = await signTestToken(claims(), SECRET);
  assert.equal(await verifySessionToken(good.slice(0, -2) + "AA", SECRET), null);
  assert.equal(await verifySessionToken(good, "corto"), null);
});
test("token: rechaza vida mayor a 900 segundos", async () => {
  assert.equal(await verifySessionToken(await signTestToken(claims({ exp: now + 1200 }), SECRET), SECRET), null);
});

test("CORS: los orígenes por defecto se suman a ALLOWED_ORIGINS, no se reemplazan", () => {
  for (const t of [authorize, validate]) {
    assert.match(t, /localhost:5500,http:\/\/127\.0\.0\.1:5500,https:\/\/gestionriesgos980-debug\.github\.io,"\+\(Deno\.env\.get\("ALLOWED_ORIGINS"\)\|\|""\)/);
    assert.doesNotMatch(t, /ALLOWED_ORIGINS"\)\|\|"http/);
  }
});
