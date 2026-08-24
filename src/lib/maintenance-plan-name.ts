/** Page name for an asset's maintenance plan document. Client-safe. */
export function maintenancePlanName(assetName: string): string {
  const base = (assetName || "Asset").trim().replace(/[\/\\<>:"|?*]/g, "-");
  return `${base} — Maintenance plan`.slice(0, 120);
}
