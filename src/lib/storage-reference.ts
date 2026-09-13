export type StorageReferenceGroup =
  | "building"
  | "fixture"
  | "subdivision"
  | "container"
  | "container_top";

export interface StorageReferenceEntry {
  group: StorageReferenceGroup;
  code: string;
  label: string;
  example: string;
  description: string;
}

export const STORAGE_REFERENCE: readonly StorageReferenceEntry[] = [
  { group:"building", code:"FS", label:"Farm Shop", example:"FS-R001-S05-L", description:"Farm Shop building prefix." },
  { group:"building", code:"HSE", label:"House", example:"HSE-CL001-S02", description:"House building prefix." },
  { group:"building", code:"PH", label:"Pump House", example:"PH-CAB001-D03", description:"Pump House building prefix." },
  { group:"building", code:"GH", label:"Greenhouse", example:"GH-SH001-S01", description:"Greenhouse building prefix." },
  { group:"building", code:"SHD##", label:"Shed", example:"SHD01-SH001-S02", description:"Numbered shed prefix." },
  { group:"fixture", code:"R###", label:"Rack", example:"FS-R001", description:"Numbered storage or equipment rack." },
  { group:"fixture", code:"SH###", label:"Shelving unit", example:"FS-SH001", description:"Numbered freestanding shelving unit." },
  { group:"fixture", code:"CAB###", label:"Cabinet", example:"PH-CAB001", description:"Numbered cabinet." },
  { group:"fixture", code:"CL###", label:"Closet", example:"HSE-CL001", description:"Numbered closet or storage enclosure." },
  { group:"fixture", code:"TB###", label:"Tool-box stack", example:"FS-TB001", description:"Numbered stackable tool-box system." },
  { group:"subdivision", code:"S##", label:"Shelf", example:"FS-R001-S05", description:"Numbered shelf within a fixture." },
  { group:"subdivision", code:"D##", label:"Drawer", example:"FS-TB001-D03", description:"Numbered drawer within a fixture or container." },
  { group:"subdivision", code:"BIN##", label:"Bin", example:"FS-SH001-BIN04", description:"Numbered bin." },
  { group:"subdivision", code:"P##", label:"Pouch or compartment", example:"BAG-0027-P03", description:"Numbered pouch or compartment within a movable container." },
  { group:"subdivision", code:"L / C / R", label:"Horizontal position", example:"FS-R001-S05-L", description:"Left, center, or right subdivision." },
  { group:"subdivision", code:"F / M / B", label:"Depth position", example:"FS-R001-S05-F", description:"Front, middle, or back subdivision." },
  { group:"container", code:"KIT-####", label:"Kit", example:"KIT-0012", description:"Stable movable kit ID; location changes do not rename it." },
  { group:"container", code:"BAG-####", label:"Bag", example:"BAG-0027", description:"Stable movable bag or mini-kit ID." },
  { group:"container", code:"CASE-####", label:"Case", example:"CASE-0014", description:"Stable movable hard or soft case ID." },
  { group:"container", code:"BOX-####", label:"Box", example:"BOX-0041", description:"Stable movable box ID." },
  { group:"container", code:"DUF-####", label:"Duffel", example:"DUF-0003", description:"Stable duffel-bag ID." },
  { group:"container", code:"MED-####", label:"Medical kit", example:"MED-0002", description:"Stable first-aid or medical-kit ID." },
  { group:"container_top", code:"TOP", label:"Entire container top", example:"TB-001-TOP", description:"Storage on the full top surface of a container." },
  { group:"container_top", code:"TOP-L / TOP-C / TOP-R", label:"Top left, center, right", example:"TB-001-TOP-R", description:"Horizontal top-surface subdivision." },
  { group:"container_top", code:"TOP-F / TOP-M / TOP-B", label:"Top front, middle, back", example:"CASE-0014-TOP-F", description:"Depth-based top-surface subdivision." },
  { group:"container_top", code:"TOP-FL … TOP-BR", label:"Top grid position", example:"CASE-0014-TOP-FR", description:"Optional combined front/middle/back and left/center/right top grid." },
] as const;

export function storagePath(parts: readonly string[]): string {
  return parts.map((part) => part.trim().toUpperCase()).filter(Boolean).join("-");
}

export function storageReferenceMatches(query: string): readonly StorageReferenceEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return STORAGE_REFERENCE;
  return STORAGE_REFERENCE.filter((entry) =>
    [entry.group, entry.code, entry.label, entry.example, entry.description]
      .some((value) => value.toLowerCase().includes(needle)),
  );
}
