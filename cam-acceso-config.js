// CAM-ACCESO-PUESTO-01 — configuración pública (solo URL y clave publicable; NUNCA service_role).
(function (root) {
  var CONFIG = {
    anonKey: 'sb_publishable_vHedj57nWXA_3pRHjJODyA_YSU_OSfh',
    postAuthorizeUrl: 'https://ywezkwitbhbyxcwuoiim.supabase.co/functions/v1/cam-acceso-post-authorize',
    sessionValidateUrl: 'https://ywezkwitbhbyxcwuoiim.supabase.co/functions/v1/cam-acceso-session-validate'
  };
  // "portería casa linda" -> "porteria-casa-linda" (el servidor lo guarda en mayúsculas).
  function normalizePostCode(v) {
    return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
      .replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '').replace(/-{2,}/g, '-');
  }
  root.CAM_ACCESO_CONFIG = CONFIG; root.camAccesoNormalizePostCode = normalizePostCode;
  if (typeof module !== 'undefined') module.exports = { CONFIG: CONFIG, normalizePostCode: normalizePostCode };
})(typeof window !== 'undefined' ? window : globalThis);
