import crypto from "node:crypto";

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_REASONS = Object.freeze(["manual","scheduled","pre-update","pre-clear"]);
const SECRET_KEY_PATTERN = /(secret|token|password|api[_-]?key|credential)/i;

export function sha256(content) { return crypto.createHash("sha256").update(content).digest("hex"); }

export function createBackupManifest(input) {
  if (!BACKUP_REASONS.includes(input.reason)) throw new Error(`Unsupported backup reason: ${input.reason}`);
  if (!input.profileId || !input.appVersion || !Number.isInteger(input.schemaVersion)) throw new Error("Backup identity and version fields are required");
  const files = Object.fromEntries(Object.entries(input.files).map(([name,content])=>[name,{sha256:sha256(content),bytes:Buffer.byteLength(content)}]));
  const manifest={format:"farmops-backup",formatVersion:BACKUP_FORMAT_VERSION,createdAt:input.createdAt??new Date().toISOString(),reason:input.reason,profile:{id:input.profileId,type:input.profileType,siteId:input.siteId??null},application:{version:input.appVersion,schemaVersion:input.schemaVersion,moduleVersions:input.moduleVersions??{}},counts:input.counts??{},encryption:input.encryption??"none",minimumCompatibleVersion:input.minimumCompatibleVersion??input.appVersion,files};
  assertSecretFree(manifest);
  return manifest;
}

export function verifyBackupManifest(manifest,files) {
  if (manifest?.format!=="farmops-backup"||manifest?.formatVersion!==BACKUP_FORMAT_VERSION) return {valid:false,reason:"unsupported-format"};
  try { assertSecretFree(manifest); } catch { return {valid:false,reason:"secret-metadata"}; }
  for (const [name,expected] of Object.entries(manifest.files??{})) {
    if (!(name in files)) return {valid:false,reason:`missing-file:${name}`};
    if (sha256(files[name])!==expected.sha256||Buffer.byteLength(files[name])!==expected.bytes) return {valid:false,reason:`checksum-mismatch:${name}`};
  }
  return {valid:true};
}

export function assertSecretFree(value,path=[]) {
  if (Array.isArray(value)) return value.forEach((item,index)=>assertSecretFree(item,[...path,String(index)]));
  if (!value||typeof value!=="object") return;
  for (const [key,child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`Secret-like field is forbidden in backups: ${[...path,key].join(".")}`);
    assertSecretFree(child,[...path,key]);
  }
}
