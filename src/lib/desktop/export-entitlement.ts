import type { FarmOpsModuleId } from "./entitlements";

export interface SnapshotExportEntitlement {
  exportId: string;
  siteId: string;
  snapshotId: string;
  modules: readonly FarmOpsModuleId[];
  issuedAt: string;
  expiresAt: string;
  maximumGenerations: 1;
}

export interface ExportRequest {
  siteId: string;
  snapshotId: string;
  modules: readonly FarmOpsModuleId[];
  generatedCount: number;
  now: Date;
}

export type ExportAuthorization =
  | { authorized: true; exportId: string; formats: readonly ["csv","json"]; includeAttachments: true; unlocksModuleAccess: false }
  | { authorized: false; reason: "site-mismatch"|"snapshot-mismatch"|"module-not-entitled"|"not-yet-valid"|"expired"|"already-used"|"invalid-entitlement" };

function timestamp(value:string):number {const parsed=Date.parse(value);if(!Number.isFinite(parsed))throw new Error("invalid");return parsed;}

export function authorizeSnapshotExport(entitlement:SnapshotExportEntitlement,request:ExportRequest):ExportAuthorization {
  if(!entitlement.exportId||!entitlement.siteId||!entitlement.snapshotId||entitlement.maximumGenerations!==1||!Number.isInteger(request.generatedCount)||request.generatedCount<0)return {authorized:false,reason:"invalid-entitlement"};
  let issued:number,expires:number;try{issued=timestamp(entitlement.issuedAt);expires=timestamp(entitlement.expiresAt);}catch{return {authorized:false,reason:"invalid-entitlement"};}if(expires<=issued)return {authorized:false,reason:"invalid-entitlement"};
  if(request.siteId!==entitlement.siteId)return {authorized:false,reason:"site-mismatch"};
  if(request.snapshotId!==entitlement.snapshotId)return {authorized:false,reason:"snapshot-mismatch"};
  if(request.now.getTime()<issued)return {authorized:false,reason:"not-yet-valid"};if(request.now.getTime()>=expires)return {authorized:false,reason:"expired"};
  if(request.generatedCount>=entitlement.maximumGenerations)return {authorized:false,reason:"already-used"};
  const allowed=new Set(entitlement.modules);if(request.modules.length===0||request.modules.some(moduleId=>!allowed.has(moduleId)))return {authorized:false,reason:"module-not-entitled"};
  return {authorized:true,exportId:entitlement.exportId,formats:["csv","json"],includeAttachments:true,unlocksModuleAccess:false};
}
