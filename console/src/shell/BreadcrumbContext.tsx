import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface Crumb {
  text: string;
  href: string;
}

interface BreadcrumbContextValue {
  crumbs: Crumb[];
  setCrumbs: (crumbs: Crumb[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/**
 * Declares the breadcrumb trail for the current page.
 *
 * AWS's trail is "Service > Resource type > Resource name", and the final crumb
 * matches the page title. Pages pass the trail below the console root; the root
 * crumb is added by the shell.
 */
export function useBreadcrumbs(crumbs: Crumb[]): void {
  const context = useContext(BreadcrumbContext);
  if (context === null) {
    throw new Error("useBreadcrumbs must be used inside a BreadcrumbProvider");
  }
  const { setCrumbs } = context;
  const key = JSON.stringify(crumbs);

  useEffect(() => {
    setCrumbs(JSON.parse(key) as Crumb[]);
  }, [key, setCrumbs]);
}

export function useBreadcrumbTrail(): Crumb[] {
  const context = useContext(BreadcrumbContext);
  if (context === null) {
    throw new Error("useBreadcrumbTrail must be used inside a BreadcrumbProvider");
  }
  return context.crumbs;
}
