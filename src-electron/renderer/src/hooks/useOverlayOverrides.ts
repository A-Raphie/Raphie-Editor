import { useState, useCallback } from "react";
import type { OverlayOverrides, OverlayOverride } from "../../../pipeline/overlayOverrides";

interface UseOverlayOverridesReturn {
  overrides: OverlayOverrides | null;
  loading: boolean;
  error: string | null;
  load: (projectId: string) => Promise<void>;
  save: (overrides: any) => Promise<void>;
}

export function useOverlayOverrides(): UseOverlayOverridesReturn {
  const [overrides, setOverrides] = useState<OverlayOverrides | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (projectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.loadOverlayOverrides(projectId);
      setOverrides(result);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load overlay overrides");
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (overridesData: any) => {
    setLoading(true);
    setError(null);
    try {
      await window.api.saveOverlayOverrides(overridesData);
    } catch (err: any) {
      setError(err?.message ?? "Failed to save overlay overrides");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { overrides, loading, error, load, save };
}