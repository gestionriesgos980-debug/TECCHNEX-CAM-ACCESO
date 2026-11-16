/**
 * TECCHNEX — política comercial pura compartida por las Edge Functions candidatas.
 * Este módulo NO realiza consultas, autentica identidades ni reemplaza las relaciones
 * tenant/producto/contrato verificadas por cada función. Se comparte solo la decisión
 * determinista sobre estados, rol operativo y fechas calendario.
 */

export const OPERATIONAL_ROLES = [
  "Vigilante",
  "Supervisor",
  "Administrador TIC",
] as const;

export const OPERATIONAL_POST_STATUSES = ["active", "suspended", "inactive"] as const;

export function isOperationalRole(value: unknown): boolean {
  return typeof value === "string" && (OPERATIONAL_ROLES as readonly string[]).includes(value);
}

/**
 * Comprueba que plan_code sea un identificador operativo bien formado.
 * La pertenencia y vigencia comercial del plan NO se decide aquí: la valida
 * el contrato central. Se evita inventar un catálogo local de planes.
 */
export function isOperationalPlanCode(value: unknown): boolean {
  return typeof value === "string" &&
    value === value.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

export function isOperationalPostStatus(value: unknown): boolean {
  return typeof value === "string" && (OPERATIONAL_POST_STATUSES as readonly string[]).includes(value);
}

export function isActiveStatus(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "active";
}

export function parseDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return value;
}

export function bogotaToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isContractDateRangeCurrent(
  startValue: unknown,
  endValue: unknown,
  today: string = bogotaToday(),
): boolean {
  const start = parseDateOnly(startValue);
  const end = endValue === null || endValue === undefined ? null : parseDateOnly(endValue);
  const validToday = parseDateOnly(today);
  if (!start || !validToday || (endValue !== null && endValue !== undefined && !end)) return false;
  return validToday >= start && (end === null || validToday <= end);
}

export interface CommercialEntitlementInput {
  clientStatus: unknown;
  productCode: unknown;
  productStatus: unknown;
  contractStatus: unknown;
  startDate: unknown;
  endDate: unknown;
}

/**
 * Aplica la parte común de la política comercial a relaciones que la función
 * llamadora ya resolvió y verificó para el mismo cliente/contrato.
 */
export function isCommercialEntitlementCurrent(
  input: CommercialEntitlementInput,
  expectedProductCode: string,
  today: string = bogotaToday(),
): boolean {
  if (!input || typeof expectedProductCode !== "string" || !expectedProductCode.trim()) return false;
  return isActiveStatus(input.clientStatus) &&
    typeof input.productCode === "string" && input.productCode.trim().toUpperCase() === expectedProductCode.trim().toUpperCase() &&
    isActiveStatus(input.productStatus) &&
    isActiveStatus(input.contractStatus) &&
    isContractDateRangeCurrent(input.startDate, input.endDate, today);
}
