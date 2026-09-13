import path from "node:path";
export const PROFILE_TYPES = Object.freeze(["live", "demo", "blank"]);
export function assertProfileType(profileType) { if (!PROFILE_TYPES.includes(profileType)) throw new Error(`Unsupported profile type: ${profileType}`); return profileType; }
export function profilePaths(userDataRoot, profileType) { const safeType=assertProfileType(profileType); const root=path.resolve(userDataRoot,"profiles",safeType); const profilesRoot=path.resolve(userDataRoot,"profiles"); if(root===profilesRoot||!root.startsWith(profilesRoot+path.sep)) throw new Error("Profile path escaped its data root"); return Object.freeze({root,database:path.join(root,"database.sqlite"),attachments:path.join(root,"attachments"),configuration:path.join(root,"configuration")}); }
