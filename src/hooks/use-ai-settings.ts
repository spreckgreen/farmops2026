import { useCallback, useEffect, useState } from "react";
import {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  isFeatureEnabled,
  type AiSettingsState,
} from "@/lib/ai-features";

function readSettings(): AiSettingsState {
  if (typeof window === "undefined") return DEFAULT_AI_SETTINGS;
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiSettingsState>;
    return {
      masterEnabled:
        typeof parsed.masterEnabled === "boolean"
          ? parsed.masterEnabled
          : DEFAULT_AI_SETTINGS.masterEnabled,
      features: {
        ...DEFAULT_AI_SETTINGS.features,
        ...(parsed.features ?? {}),
      },
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

function writeSettings(next: AiSettingsState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      AI_SETTINGS_STORAGE_KEY,
      JSON.stringify(next),
    );
    window.dispatchEvent(new CustomEvent("farmops:ai-settings-changed"));
  } catch {
    /* ignore quota */
  }
}

/** Full settings hook — read + write, with cross-tab + same-tab sync. */
export function useAiSettings() {
  const [state, setState] = useState<AiSettingsState>(() => readSettings());

  useEffect(() => {
    const sync = () => setState(readSettings());
    window.addEventListener("storage", sync);
    window.addEventListener("farmops:ai-settings-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("farmops:ai-settings-changed", sync);
    };
  }, []);

  const setMaster = useCallback((enabled: boolean) => {
    const next = { ...readSettings(), masterEnabled: enabled };
    writeSettings(next);
    setState(next);
  }, []);

  const setFeature = useCallback((id: string, enabled: boolean) => {
    const cur = readSettings();
    const next: AiSettingsState = {
      ...cur,
      features: { ...cur.features, [id]: enabled },
    };
    writeSettings(next);
    setState(next);
  }, []);

  const reset = useCallback(() => {
    writeSettings(DEFAULT_AI_SETTINGS);
    setState(DEFAULT_AI_SETTINGS);
  }, []);

  return { state, setMaster, setFeature, reset };
}

/** Lightweight check — just returns a boolean for one feature. */
export function useAiFeatureEnabled(id: string): boolean {
  const [enabled, setEnabled] = useState<boolean>(() =>
    isFeatureEnabled(readSettings(), id),
  );

  useEffect(() => {
    const sync = () => setEnabled(isFeatureEnabled(readSettings(), id));
    window.addEventListener("storage", sync);
    window.addEventListener("farmops:ai-settings-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("farmops:ai-settings-changed", sync);
    };
  }, [id]);

  return enabled;
}
