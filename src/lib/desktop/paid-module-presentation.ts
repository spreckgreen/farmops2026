import type { FarmOpsModuleId, FeatureAvailability } from "./entitlements";

export const SUBSCRIPTION_ROUTE = "/subscription" as const;

export interface PaidModulePresentation {
  moduleId: FarmOpsModuleId;
  access: "full" | "locked";
  commercialLabel: "Free for life" | "Paid feature" | "Subscription required";
  message: string;
  subscriptionRoute: typeof SUBSCRIPTION_ROUTE | null;
  trialEndsAt: string | null;
  retainedRecordCount: number;
  retainedAttachmentCount: number;
  dataDisposition: "accessible" | "retained_locked";
  actions: readonly ("subscribe" | "one_time_export" | "purge")[];
  requiresFirstUseAcknowledgement: boolean;
}

export function paidModulePresentation({moduleId,availability,recordCount=0,attachmentCount=0}:{moduleId:FarmOpsModuleId;availability:FeatureAvailability;recordCount?:number;attachmentCount?:number}):PaidModulePresentation {
  if (!Number.isInteger(recordCount)||recordCount<0||!Number.isInteger(attachmentCount)||attachmentCount<0) throw new Error("Retained data counts must be non-negative integers");
  if (moduleId==="procedures") return {moduleId,access:"full",commercialLabel:"Free for life",message:"Procedures is included permanently.",subscriptionRoute:null,trialEndsAt:null,retainedRecordCount:recordCount,retainedAttachmentCount:attachmentCount,dataDisposition:"accessible",actions:["purge"],requiresFirstUseAcknowledgement:false};
  if (availability.state==="available") {
    const trial=availability.source==="site_trial"||availability.source==="trial_extension";
    return {moduleId,access:"full",commercialLabel:"Paid feature",message:trial?`Included in your all-feature trial through ${availability.expiresAt}. Data entered here will remain stored but become inaccessible unless you subscribe after the trial.`:"Included with your active entitlement.",subscriptionRoute:SUBSCRIPTION_ROUTE,trialEndsAt:trial?availability.expiresAt:null,retainedRecordCount:recordCount,retainedAttachmentCount:attachmentCount,dataDisposition:"accessible",actions:["subscribe","purge"],requiresFirstUseAcknowledgement:trial};
  }
  if (availability.state==="trial-expired"||availability.state==="locked") return {moduleId,access:"locked",commercialLabel:"Subscription required",message:"Your data remains stored on this system and will become accessible again after upgrading.",subscriptionRoute:SUBSCRIPTION_ROUTE,trialEndsAt:availability.state==="trial-expired"?availability.expiredAt:null,retainedRecordCount:recordCount,retainedAttachmentCount:attachmentCount,dataDisposition:"retained_locked",actions:["subscribe","one_time_export","purge"],requiresFirstUseAcknowledgement:false};
  return {moduleId,access:"full",commercialLabel:"Paid feature",message:"This entitled feature needs attention before it can be used.",subscriptionRoute:SUBSCRIPTION_ROUTE,trialEndsAt:null,retainedRecordCount:recordCount,retainedAttachmentCount:attachmentCount,dataDisposition:"accessible",actions:["subscribe","purge"],requiresFirstUseAcknowledgement:false};
}
