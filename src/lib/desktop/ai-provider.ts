import type { FarmOpsModuleId } from "./entitlements";

export type AiMode = "disabled" | "byok" | "local" | "farmops";

export interface AiProviderConfiguration {
	id: string;
	mode: AiMode;
	provider: "none" | "openai-compatible" | "ollama" | "farmops";
	endpoint: string | null;
	credentialReference: string | null;
	allowedModules: readonly FarmOpsModuleId[];
	dataLeavesDevice: boolean;
	enabled: boolean;
}

export type AiProviderStatus =
	| { ready: true }
	| {
			ready: false;
			reason:
				| "disabled"
				| "credential-required"
				| "endpoint-required"
				| "insecure-remote-endpoint"
				| "module-not-authorized"
				| "entitlement-required";
		};

function trimOrNull(value: string | null): string | null {
	const next = value?.trim();
	return next ? next : null;
}

function isLoopbackEndpoint(endpoint: string): boolean {
	try {
		const url = new URL(endpoint);
		return (
			url.protocol === "http:" ||
			url.protocol === "https:"
		) && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
	} catch {
		return false;
	}
}

function isHttpsEndpoint(endpoint: string): boolean {
	try {
		return new URL(endpoint).protocol === "https:";
	} catch {
		return false;
	}
}

export function evaluateAiProvider(
	config: AiProviderConfiguration,
	moduleId: FarmOpsModuleId,
	aiEntitled: boolean,
): AiProviderStatus {
	if (!config.enabled || config.mode === "disabled") {
		return { ready: false, reason: "disabled" };
	}
	if (!config.allowedModules.includes(moduleId)) {
		return { ready: false, reason: "module-not-authorized" };
	}
	if (!aiEntitled) {
		return { ready: false, reason: "entitlement-required" };
	}

	const endpoint = trimOrNull(config.endpoint);
	const credentialReference = trimOrNull(config.credentialReference);

	if (config.mode === "byok") {
		if (!endpoint) return { ready: false, reason: "endpoint-required" };
		if (!credentialReference) return { ready: false, reason: "credential-required" };
		try {
			assertCredentialReference(credentialReference);
		} catch {
			return { ready: false, reason: "credential-required" };
		}
	}

	if (config.mode === "farmops") {
		if (!credentialReference) return { ready: false, reason: "credential-required" };
		try {
			assertCredentialReference(credentialReference);
		} catch {
			return { ready: false, reason: "credential-required" };
		}
	}

	if (config.mode === "local") {
		if (!endpoint) return { ready: false, reason: "endpoint-required" };
		// Local mode must stay loopback-only so a misconfigured endpoint cannot
		// exfiltrate prompts while appearing to be on-device.
		if (!isLoopbackEndpoint(endpoint)) {
			return { ready: false, reason: "insecure-remote-endpoint" };
		}
	}

	if (endpoint && config.dataLeavesDevice && !isHttpsEndpoint(endpoint)) {
		return { ready: false, reason: "insecure-remote-endpoint" };
	}

	return { ready: true };
}

export type BackupSafeAiConfiguration = Omit<AiProviderConfiguration, "credentialReference"> & {
	credentialConfigured: boolean;
	credentialReference: null;
};

export function toBackupSafeAiConfiguration(
	config: AiProviderConfiguration,
): BackupSafeAiConfiguration {
	return {
		...config,
		credentialConfigured: Boolean(trimOrNull(config.credentialReference)),
		credentialReference: null,
	};
}

export function assertCredentialReference(reference: string): void {
	if (!/^(windows-credential-manager|secret-service):\/\/[A-Za-z0-9._/-]+$/.test(reference)) {
		throw new Error("AI credentials must use the operating-system credential vault");
	}
}
