import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fetchConsoleSummary } from "./summary";
import type { ConsoleSummary } from "./summary";
import { resolveAccessKeyId, setAccessKeyId as persistAccessKeyId } from "./endpoint";

interface EmulatorContextValue {
  summary: ConsoleSummary | null;
  loading: boolean;
  error: Error | null;
  region: string;
  setRegion: (region: string) => void;
  accessKeyId: string;
  setAccessKeyId: (accessKeyId: string) => void;
  /** Account the emulator will attribute requests to, given the current access key. */
  effectiveAccountId: string;
  /**
   * "unknown" when the catalog is unavailable — an older emulator build may not
   * serve it. Callers must not render that as "disabled".
   */
  serviceStatus: (serviceId: string) => "running" | "disabled" | "unknown";
  reload: () => void;
}

const EmulatorContext = createContext<EmulatorContextValue | null>(null);

const TWELVE_DIGITS = /^\d{12}$/;

export function EmulatorProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<ConsoleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [region, setRegion] = useState<string>("us-east-1");
  const [accessKeyId, setAccessKeyIdState] = useState<string>(resolveAccessKeyId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchConsoleSummary(controller.signal)
      .then((next) => {
        setSummary(next);
        setRegion((current) => (current === "us-east-1" ? next.defaultRegion : current));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [reloadToken]);

  const value = useMemo<EmulatorContextValue>(() => {
    const enabledIds = new Set(
      (summary?.services ?? []).filter((service) => service.enabled).map((service) => service.id),
    );

    return {
      summary,
      loading,
      error,
      region,
      setRegion,
      accessKeyId,
      setAccessKeyId: (next: string) => {
        persistAccessKeyId(next);
        setAccessKeyIdState(next.trim() === "" ? "test" : next.trim());
      },
      effectiveAccountId: TWELVE_DIGITS.test(accessKeyId)
        ? accessKeyId
        : (summary?.defaultAccountId ?? "000000000000"),
      serviceStatus: (serviceId: string) => {
        if (summary === null) {
          return "unknown";
        }
        return enabledIds.has(serviceId) ? "running" : "disabled";
      },
      reload: () => setReloadToken((token) => token + 1),
    };
  }, [summary, loading, error, region, accessKeyId]);

  return <EmulatorContext.Provider value={value}>{children}</EmulatorContext.Provider>;
}

export function useEmulator(): EmulatorContextValue {
  const value = useContext(EmulatorContext);
  if (value === null) {
    throw new Error("useEmulator must be used inside an EmulatorProvider");
  }
  return value;
}
