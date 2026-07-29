import { Suspense, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import AppLayout from "@cloudscape-design/components/app-layout";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import Flashbar from "@cloudscape-design/components/flashbar";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import Spinner from "@cloudscape-design/components/spinner";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import type { SideNavigationProps } from "@cloudscape-design/components/side-navigation";

import { useEmulator } from "@platform/EmulatorContext";
import { servicePath, servicesByCategory } from "@services/catalog";
import { useBreadcrumbTrail } from "./BreadcrumbContext";
import { useNotifications } from "./NotificationContext";
import { RegionAccountModal } from "./RegionAccountModal";
import { ServiceSearch } from "./ServiceSearch";
import { useActiveServiceNav } from "./ServiceNavContext";
import { UNAVAILABLE_HREF } from "./navUnavailable";
import { ServiceIcon } from "./ServiceIcon";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { items } = useNotifications();
  const crumbs = useBreadcrumbTrail();
  const { summary, region, effectiveAccountId } = useEmulator();
  const serviceNav = useActiveServiceNav();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // All 53 emulated services are navigable. Categories start collapsed so the rail stays
  // scannable, matching how AWS groups its "All services" drawer.
  const navItems = useMemo<SideNavigationProps.Item[]>(() => {
    const grouped = servicesByCategory().map((group) => ({
      type: "expandable-link-group" as const,
      text: group.category,
      href: "/services",
      defaultExpanded: false,
      items: group.services.map((entry) => ({
        type: "link" as const,
        // SideNavigation renders text only, so the icon is composed into the label.
        text: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <ServiceIcon entry={entry} size={18} />
            {entry.shortName}
          </span>
        ) as unknown as string,
        href: `/${servicePath(entry)}`,
      })),
    }));

    return [
      { type: "link", text: "Console home", href: "/" },
      { type: "link", text: "All services", href: "/services" },
      { type: "divider" },
      ...grouped,
    ];
  }, []);

  // AWS starts the trail at the service ("Amazon S3 > Buckets > name") with no
  // console-root crumb, so the shell renders exactly what the page declares.
  const breadcrumbItems = crumbs;

  return (
    <>
      <div id="lcs-top-navigation">
        <TopNavigation
          identity={{
            href: "/",
            title: "LCS",
            // Runtime path, not processed by Vite, so it carries the full base prefix.
            logo: { src: "/_lcs/ui/lcs-logo.png", alt: "LCS — Local Cloud Services" },
            onFollow: (event) => {
              event.preventDefault();
              navigate("/");
            },
          }}
          search={<ServiceSearch />}
          utilities={[
            {
              type: "button",
              text: region,
              iconName: "map",
              ariaLabel: "Region and account settings",
              onClick: () => setSettingsOpen(true),
            },
            {
              type: "button",
              text: effectiveAccountId,
              iconName: "user-profile",
              ariaLabel: "Account settings",
              onClick: () => setSettingsOpen(true),
            },
            {
              type: "button",
              text: summary ? `v${summary.version}` : "",
              external: false,
              disableUtilityCollapse: true,
            },
          ]}
        />
      </div>

      <AppLayout
        headerSelector="#lcs-top-navigation"
        navigation={
          <SideNavigation
            header={
              serviceNav === null
                ? { href: "/", text: "Local Cloud Services" }
                : { href: serviceNav.href, text: serviceNav.title }
            }
            activeHref={
              serviceNav === null
                ? location.pathname === "/"
                  ? "/"
                  : `/${location.pathname.split("/")[1] ?? ""}`
                : location.pathname
            }
            items={serviceNav === null ? navItems : serviceNav.items}
            onFollow={(event) => {
              if (event.detail.external) {
                return;
              }
              event.preventDefault();
              // Greyed-out entries for AWS pages LCS cannot back are inert.
              if (event.detail.href.startsWith(UNAVAILABLE_HREF)) {
                return;
              }
              navigate(event.detail.href);
            }}
          />
        }
        breadcrumbs={
          <BreadcrumbGroup
            items={breadcrumbItems}
            onFollow={(event) => {
              event.preventDefault();
              navigate(event.detail.href);
            }}
          />
        }
        notifications={<Flashbar items={items} stackItems />}
        toolsHide
        content={
          <Suspense fallback={<Spinner size="large" />}>
            <Outlet />
          </Suspense>
        }
      />

      <RegionAccountModal visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} />
    </>
  );
}
