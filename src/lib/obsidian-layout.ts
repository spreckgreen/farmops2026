// Shared mapping of inventory item types -> Obsidian subfolders, and the
// canonical vault root used by the Obsidian sync feature.

export const VAULT_ROOT = "BosteadFarms";

export const PROJECTS_FOLDER = "00 Projects";
export const DAILY_FOLDER = `${PROJECTS_FOLDER}/01 Daily Tasks`;
export const WEEKLY_FOLDER = `${PROJECTS_FOLDER}/02 Weekly Status`;
export const MONTHLY_FOLDER = `${PROJECTS_FOLDER}/03 Monthly Projects`;
export const QUARTERLY_FOLDER = `${PROJECTS_FOLDER}/04 Quarterly Projects`;
export const YEARLY_FOLDER = `${PROJECTS_FOLDER}/05 Yearly Projects`;

export const TASKS_FOLDER = "Tasks";
export const MAINTENANCE_FOLDER = "Maintenance";
export const CONSUMABLES_FOLDER = "Consumables";

export type InventoryTypeDef = {
  value: string;
  label: string;
  folder: string; // relative to vault root
};

export const INVENTORY_TYPES: InventoryTypeDef[] = [
  { value: "20_outbuildings", label: "20 Outbuildings", folder: "20 Outbuildings" },
  { value: "21_infrastructure_system", label: "21 Infrastructure System", folder: "21 Infrastructure systems" },
  { value: "22_infrastructure_component", label: "22 Infrastructure component", folder: "21 Infrastructure systems/22 Infrastructure components" },
  { value: "23_communication", label: "23 Communication", folder: "21 Infrastructure systems/23 Communication" },
  { value: "24_energy", label: "24 Energy", folder: "21 Infrastructure systems/24 Energy" },
  { value: "24_1_boiler", label: "24.1 Boiler", folder: "21 Infrastructure systems/24 Energy/24.1 Boiler" },
  { value: "24_2_farm_shop_electrical", label: "24.2 Farm Shop Electrical", folder: "21 Infrastructure systems/24 Energy/24.2 Farm Shop Electrical" },
  { value: "24_3_house_electrical", label: "24.3 House Electrical", folder: "21 Infrastructure systems/24 Energy/24.3 House Electrical" },
  { value: "24_4_pump_house_electrical", label: "24.4 Pump House Electrical", folder: "21 Infrastructure systems/24 Energy/24.4 Pump House Electrical" },
  { value: "25_sanitation", label: "25 Sanitation", folder: "21 Infrastructure systems/25 Sanitation" },
  { value: "25_1_septic_house", label: "25.1 Septic House", folder: "21 Infrastructure systems/25 Sanitation/25.1 Septic House" },
  { value: "25_2_septic_farm_shop", label: "25.2 Septic Farm Shop", folder: "21 Infrastructure systems/25 Sanitation/25.2 Septic Farm Shop" },
  { value: "26_water", label: "26 Water", folder: "21 Infrastructure systems/26 Water" },
  { value: "26_1_well_house", label: "26.1 Well House", folder: "21 Infrastructure systems/26 Water/26.1 Well House" },
  { value: "26_2_cistern_farm_shop", label: "26.2 Cistern Farm Shop", folder: "21 Infrastructure systems/26 Water/26.2 Cistern Farm Shop" },
  { value: "26_3_well_ag", label: "26.3 Well Ag", folder: "21 Infrastructure systems/26 Water/26.3 Well Ag" },
  { value: "26_4_cistern_ag_well", label: "26.4 Cistern Ag Well", folder: "21 Infrastructure systems/26 Water/26.4 Cistern Ag Well" },
  { value: "27_food_production", label: "27 Food Production", folder: "27 Food Production" },
  { value: "27_1_garden", label: "27.1 Garden", folder: "27 Food Production/27.1 Garden" },
  { value: "27_2_orchard", label: "27.2 Orchard", folder: "27 Food Production/27.2 Orchard" },
  { value: "27_3_pastures", label: "27.3 Pastures", folder: "27 Food Production/27.3 Pastures" },
  { value: "30_equipment", label: "30 Equipment", folder: "30 Equipment" },
  { value: "31_parts", label: "31 Parts", folder: "30 Equipment/31 Parts Catalog" },
  { value: "40_animals", label: "40 Animals", folder: "40 Animals" },
  { value: "41_feed", label: "41 Feed", folder: "40 Animals/41 Feed" },
  { value: "50_food_storage", label: "50 Food Storage", folder: "50 Food Storage" },
  { value: "51_land_zone", label: "51 Land Zone", folder: "50 Food Storage/51 Land Zone" },
  { value: "52_plants", label: "52 Plants", folder: "50 Food Storage/52 Plants" },
];

export const INVENTORY_DEFAULT_FOLDER = "Inventory";

export function inventoryFolderFor(itemType: string | null | undefined): string {
  const t = INVENTORY_TYPES.find((x) => x.value === itemType);
  return t ? t.folder : INVENTORY_DEFAULT_FOLDER;
}

// All top-level folders inside the vault root that the sync walks recursively.
export const TOP_LEVEL_FOLDERS = [
  PROJECTS_FOLDER,
  "20 Outbuildings",
  "21 Infrastructure systems",
  "27 Food Production",
  "30 Equipment",
  "40 Animals",
  "50 Food Storage",
  TASKS_FOLDER,
  MAINTENANCE_FOLDER,
  CONSUMABLES_FOLDER,
  INVENTORY_DEFAULT_FOLDER, // legacy
];

/**
 * Classify a vault-relative path (no leading VAULT_ROOT) into a record kind.
 * Returns null if the path doesn't match any known mapping.
 */
export function classifyPath(relPath: string): {
  kind: "daily_note" | "task" | "project" | "summary" | "inventory_item" | "maintenance_record" | "consumable";
  summaryMode?: "weekly_report" | "quarter_review" | "project_rollup" | "daily_recap" | "monthly_rollup" | "yearly_rollup";
  rollupPeriod?: "monthly" | "yearly";
} | null {
  const p = relPath.replace(/^\/+/, "");
  if (p.startsWith(`${DAILY_FOLDER}/`)) return { kind: "daily_note" };
  if (p.startsWith(`${WEEKLY_FOLDER}/`)) return { kind: "summary", summaryMode: "weekly_report" };
  if (p.startsWith(`${MONTHLY_FOLDER}/`)) return { kind: "summary", summaryMode: "monthly_rollup", rollupPeriod: "monthly" };
  if (p.startsWith(`${QUARTERLY_FOLDER}/`)) return { kind: "summary", summaryMode: "quarter_review" };
  if (p.startsWith(`${YEARLY_FOLDER}/`)) return { kind: "summary", summaryMode: "yearly_rollup", rollupPeriod: "yearly" };
  if (p.startsWith(`${TASKS_FOLDER}/`)) return { kind: "task" };
  if (p.startsWith(`${MAINTENANCE_FOLDER}/`)) return { kind: "maintenance_record" };
  if (p.startsWith(`${CONSUMABLES_FOLDER}/`)) return { kind: "consumable" };
  // legacy flat folders
  if (p.startsWith("Daily/")) return { kind: "daily_note" };
  if (p.startsWith("Projects/")) return { kind: "project" };
  if (p.startsWith("Summaries/")) return { kind: "summary" };
  if (p.startsWith("Inventory/")) return { kind: "inventory_item" };
  // any inventory type folder
  for (const t of INVENTORY_TYPES) {
    if (p.startsWith(`${t.folder}/`)) return { kind: "inventory_item" };
  }
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function monthlyFileName(periodStart: string, projectTag: string | null): string {
  const d = new Date(periodStart);
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const tag = (projectTag || "rollup").trim();
  return `${y}${m} ${tag}`;
}

export function quarterlyFileName(periodStart: string, projectTag: string | null): string {
  const d = new Date(periodStart);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  const tag = (projectTag || "review").trim();
  return `${y}Q${q} ${tag}`;
}

export function yearlyFileName(periodStart: string, projectTag: string | null): string {
  const d = new Date(periodStart);
  const y = d.getUTCFullYear();
  const tag = (projectTag || "rollup").trim();
  return `${y} ${tag}`;
}

export function isYearlyRollup(periodStart: string, periodEnd: string): boolean {
  const a = new Date(periodStart).getTime();
  const b = new Date(periodEnd).getTime();
  if (!isFinite(a) || !isFinite(b)) return false;
  const days = (b - a) / 86400000;
  return days >= 300;
}
