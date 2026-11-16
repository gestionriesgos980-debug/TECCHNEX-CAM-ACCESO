// CAM-ACCESO-PUESTO-01 — pruebas locales de la copia del CRM (panel de puestos CAM-ACCESO). Sin red.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const h = readFileSync(new URL("../CRM/TECCHNEX_ADMIN_MAESTRO_CRM_UNIVERSAL_LAB01_CAM_ACCESO.html", import.meta.url), "utf8");
const count = (re) => (h.match(re) || []).length;

test("conserva el panel CAM-RONDAS y agrega uno de CAM-ACCESO", () => {
  assert.equal(count(/id="camRondasPostsPanel"/g), 1);
  assert.equal(count(/id="camAccesoPostsPanel"/g), 1);
  assert.equal(count(/invoke\("cam-rondas-post-admin"/g), 1);
  assert.equal(count(/invoke\("cam-acceso-post-admin"/g), 1);
});
test("cada panel filtra solo los contratos de su producto", () => {
  assert.equal(count(/\.toUpperCase\(\) === "CAM-RONDAS"/g), 1);
  assert.equal(count(/\.toUpperCase\(\) === "CAM-ACCESO"/g), 1);
});
test("los identificadores del formulario no chocan entre paneles", () => {
  for (const id of ["Contract", "Code", "Name", "Role", "Password", "Create", "Reload"]) {
    assert.equal(count(new RegExp(`id="camPost${id}"`, "g")), 1, `camPost${id}`);
    assert.equal(count(new RegExp(`id="camAccPost${id}"`, "g")), 1, `camAccPost${id}`);
  }
});
test("mantiene el arranque de ambos paneles y la exigencia de MFA AAL2", () => {
  assert.match(h, /setupCamRondasPosts\(c\);\s*setupCamAccesoPosts\(c\);/);
  assert.ok(count(/currentLevel !== "aal2"/g) >= 2);
});
test("el panel nuevo sugiere el formato servicio-cliente y no contiene secretos", () => {
  assert.match(h, /placeholder="Ej\. porteria-casa-linda"/);
  assert.doesNotMatch(h, /sb_secret_|eyJ[A-Za-z0-9_-]{20,}\./);
});

test("identifica claramente el cliente y el contrato antes de crear puestos en ambos productos", () => {
  assert.equal(count(/id="camRondasClientContext"/g), 1);
  assert.equal(count(/id="camAccesoClientContext"/g), 1);
  assert.match(h, /updatePostClientContext\("CAM-RONDAS", client, "camPostContract", "camRondasClientContext"\)/);
  assert.match(h, /updatePostClientContext\("CAM-ACCESO", client, "camAccPostContract", "camAccesoClientContext"\)/);
  assert.match(h, /CLIENTE: \$\{client\.name/);
  assert.match(h, /Identificación \/ NIT:/);
});
