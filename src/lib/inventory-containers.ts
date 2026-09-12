export const CONTAINER_KINDS = [
  "item", "kit", "bag", "case", "toolbox", "drawer_unit", "pouch",
] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

export const CONTAINER_CATEGORIES = [
  "tools", "medical", "general", "compute", "vehicle_recovery",
] as const;
export type ContainerCategory = (typeof CONTAINER_CATEGORIES)[number];

export const COMPARTMENT_TYPES = [
  "main_compartment", "drawer", "pocket", "lid_compartment", "tray",
  "divider_bin", "removable_pouch", "device_sleeve", "document_sleeve",
  "cable_pocket", "section", "attachment_point",
] as const;
export type CompartmentType = (typeof COMPARTMENT_TYPES)[number];

export interface SuggestedCompartment {
  code: string;
  name: string;
  compartmentType: CompartmentType;
  sortOrder: number;
}
export interface ContainerTemplate {
  id: "ridgid_stackable_toolbox" | "ridgid_drawer_toolbox"
    | "first_aid_medical_bag" | "first_aid_medical_case"
    | "duffel_bag_kit" | "computer_case" | "vehicle_recovery_kit";
  label: string;
  containerKind: Exclude<ContainerKind, "item">;
  category: ContainerCategory;
  suggestedCompartments: SuggestedCompartment[];
}

export const CONTAINER_TEMPLATES: readonly ContainerTemplate[] = [
  { id:"ridgid_stackable_toolbox", label:"RIDGID stackable toolbox",
    containerKind:"toolbox", category:"tools", suggestedCompartments:[
      {code:"MAIN",name:"Main bay",compartmentType:"main_compartment",sortOrder:10},
      {code:"LID",name:"Lid storage",compartmentType:"lid_compartment",sortOrder:20},
    ]},
  { id:"ridgid_drawer_toolbox", label:"RIDGID drawer toolbox",
    containerKind:"drawer_unit", category:"tools", suggestedCompartments:[1,2,3].map((number)=>({
      code:"D"+number, name:"Drawer "+number, compartmentType:"drawer" as const, sortOrder:number*10,
    }))},
  { id:"first_aid_medical_bag", label:"First aid / medical bag",
    containerKind:"bag", category:"medical", suggestedCompartments:[
      {code:"MAIN",name:"Main compartment",compartmentType:"main_compartment",sortOrder:10},
      {code:"FRONT",name:"Front pocket",compartmentType:"pocket",sortOrder:20},
      {code:"LEFT",name:"Left pocket",compartmentType:"pocket",sortOrder:30},
      {code:"RIGHT",name:"Right pocket",compartmentType:"pocket",sortOrder:40},
      {code:"POUCH",name:"Removable pouch",compartmentType:"removable_pouch",sortOrder:50},
    ]},
  { id:"first_aid_medical_case", label:"First aid / medical case",
    containerKind:"case", category:"medical", suggestedCompartments:[
      {code:"TRAY",name:"Upper tray",compartmentType:"tray",sortOrder:10},
      {code:"LOWER",name:"Lower bay",compartmentType:"main_compartment",sortOrder:20},
      {code:"LID",name:"Lid organizer",compartmentType:"lid_compartment",sortOrder:30},
    ]},
  { id:"duffel_bag_kit", label:"Duffel bag kit",
    containerKind:"bag", category:"general", suggestedCompartments:[
      {code:"MAIN",name:"Main compartment",compartmentType:"main_compartment",sortOrder:10},
      {code:"LEFT",name:"Left end pocket",compartmentType:"pocket",sortOrder:20},
      {code:"RIGHT",name:"Right end pocket",compartmentType:"pocket",sortOrder:30},
      {code:"FRONT",name:"Front pocket",compartmentType:"pocket",sortOrder:40},
    ]},
  { id:"computer_case", label:"Computer case",
    containerKind:"case", category:"compute", suggestedCompartments:[
      {code:"DEVICE",name:"Computer sleeve",compartmentType:"device_sleeve",sortOrder:10},
      {code:"POWER",name:"Power supply pocket",compartmentType:"cable_pocket",sortOrder:20},
      {code:"ACCESSORY",name:"Accessory pocket",compartmentType:"pocket",sortOrder:30},
      {code:"DOCS",name:"Document sleeve",compartmentType:"document_sleeve",sortOrder:40},
    ]},
  { id:"vehicle_recovery_kit", label:"Vehicle recovery kit",
    containerKind:"kit", category:"vehicle_recovery", suggestedCompartments:[
      {code:"STRAPS",name:"Straps and ropes",compartmentType:"section",sortOrder:10},
      {code:"RIGGING",name:"Shackles and rigging",compartmentType:"section",sortOrder:20},
      {code:"WINCH",name:"Winch accessories",compartmentType:"section",sortOrder:30},
      {code:"TIRE",name:"Tire and air",compartmentType:"section",sortOrder:40},
      {code:"PPE",name:"Gloves and PPE",compartmentType:"pocket",sortOrder:50},
      {code:"TOOLS",name:"Recovery tools",compartmentType:"section",sortOrder:60},
    ]},
] as const;

export function getContainerTemplate(id:string):ContainerTemplate|undefined {
  return CONTAINER_TEMPLATES.find((template)=>template.id===id);
}
export function isContainerKind(value:string):value is ContainerKind {
  return (CONTAINER_KINDS as readonly string[]).includes(value);
}
export function compartmentPath(
  compartments:Array<{id:string;parentId:string|null;code:string}>,
  compartmentId:string,
):string {
  const byId=new Map(compartments.map((row)=>[row.id,row]));
  const path:string[]=[];
  const seen=new Set<string>();
  let current=byId.get(compartmentId);
  while(current){
    if(seen.has(current.id)) throw new Error("Compartment hierarchy contains a cycle.");
    seen.add(current.id);
    path.unshift(current.code);
    current=current.parentId ? byId.get(current.parentId) : undefined;
  }
  if(path.length===0) throw new Error("Compartment not found.");
  return path.join(" / ");
}
export function canAssignCompartment(
  compartmentContainerId:string, selectedContainerId:string|null,
):boolean {
  return selectedContainerId!==null && compartmentContainerId===selectedContainerId;
}
