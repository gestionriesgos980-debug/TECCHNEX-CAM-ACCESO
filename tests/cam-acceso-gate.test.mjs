// CAM-ACCESO-PUESTO-01 — pruebas locales del ingreso por puesto (pantalla). No usan red.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { CONFIG, normalizePostCode: n } = require("../CAM-ACCESO/cam-acceso-config.js");
const html = readFileSync(new URL("../CAM-ACCESO/index.html", import.meta.url), "utf8");
const gate = html.match(/\(function initCamAccesoPuestoGate\(\)\{[\s\S]*?\n\}\)\(\);/)[0];

test("normalización del código de puesto", () => {
  assert.equal(n("portería casa linda"), "porteria-casa-linda");
  assert.equal(n("  Ronda  Casa   Linda "), "ronda-casa-linda");
  assert.equal(n("PORTERIA_Casa.Linda"), "porteria_casa.linda");
  assert.equal(n("conjunto el pino #2"), "conjunto-el-pino-2");
  assert.equal(n(""), "");
});
test("configuración pública: clave publicable y funciones de CAM-ACCESO", () => {
  assert.match(CONFIG.anonKey, /^sb_publishable_/);
  assert.match(CONFIG.postAuthorizeUrl, /\/functions\/v1\/cam-acceso-post-authorize$/);
  assert.match(CONFIG.sessionValidateUrl, /\/functions\/v1\/cam-acceso-session-validate$/);
});
test("sin credenciales de laboratorio ni cuentas locales", () => {
  for (const bad of ["LAB-2026", "admin.demo", "porteria.demo", "usuarios_demo", "service_role"]) assert.equal(html.includes(bad), false, bad);
});
test("el ingreso envía el producto CAM-ACCESO y exige authorized === true", () => {
  assert.match(gate, /product_code:'CAM-ACCESO'/);
  assert.match(gate, /p\.authorized===true/);
});
test("clave y token solo en memoria: sin localStorage ni sessionStorage en el ingreso", () => {
  assert.doesNotMatch(gate, /localStorage|sessionStorage|indexedDB/);
});
test("falla cerrado: bloquea ante 4xx del servidor o token vencido sin conexión", () => {
  assert.match(gate, /r\.http>=400&&r\.http<500\)lock/);
  assert.match(gate, /Date\.now\(\)>=tokenExp\)lock/);
  assert.match(gate, /El acceso permanece bloqueado/);
});
test("revalida periódicamente y al volver a la pestaña", () => {
  assert.match(gate, /setInterval\(renew,RENEW_MS\)/);
  assert.match(gate, /visibilitychange/);
});
test("roles: Administrador TIC = perfil admin; el resto = portería", () => {
  assert.match(gate, /role==='Administrador TIC'\?'cam-acceso-perfil-admin':'cam-acceso-perfil-porteria'/);
});
test("el resto de la app no depende de elementos retirados", () => {
  const outside = html.replace(gate, "");
  assert.doesNotMatch(outside, /refreshUsers|readUsers|writeUsers/);
});
