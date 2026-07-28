import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SideNavigationProps } from "@cloudscape-design/components/side-navigation";

/**
 * Service-scoped left navigation.
 *
 * Inside a service, the AWS console replaces the global navigation with that service's
 * own nav — the S3 console shows "Amazon S3" with Buckets / Access management / Storage
 * management, not a list of every AWS service. A service declares its nav here and the
 * shell renders it; the global catalog nav is the fallback everywhere else.
 */
export interface ServiceNav {
  /** Nav header, e.g. "Amazon S3". */
  title: string;
  /** Route the header links to, e.g. "/s3". */
  href: string;
  items: SideNavigationProps.Item[];
}

interface ServiceNavContextValue {
  nav: ServiceNav | null;
  setNav: (nav: ServiceNav | null) => void;
}

const ServiceNavContext = createContext<ServiceNavContextValue | null>(null);

export function ServiceNavProvider({ children }: { children: ReactNode }) {
  const [nav, setNav] = useState<ServiceNav | null>(null);
  const value = useMemo(() => ({ nav, setNav }), [nav]);
  return <ServiceNavContext.Provider value={value}>{children}</ServiceNavContext.Provider>;
}

/**
 * Declares the left navigation for the current service.
 *
 * Clears on unmount so leaving a service restores the global navigation.
 */
export function useServiceNav(nav: ServiceNav): void {
  const context = useContext(ServiceNavContext);
  if (context === null) {
    throw new Error("useServiceNav must be used inside a ServiceNavProvider");
  }
  const { setNav } = context;
  const key = JSON.stringify(nav);

  useEffect(() => {
    setNav(JSON.parse(key) as ServiceNav);
    return () => setNav(null);
  }, [key, setNav]);
}

export function useActiveServiceNav(): ServiceNav | null {
  const context = useContext(ServiceNavContext);
  if (context === null) {
    throw new Error("useActiveServiceNav must be used inside a ServiceNavProvider");
  }
  return context.nav;
}
