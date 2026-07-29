import type { SideNavigationProps } from "@cloudscape-design/components/side-navigation";

/**
 * Nav hrefs starting with this prefix are inert — the shell refuses to navigate to them.
 */
export const UNAVAILABLE_HREF = "#lcs-unavailable";

/**
 * A greyed-out navigation entry for an AWS console page LCS cannot back.
 *
 * Dropping these entries makes the nav look complete when it is not, and pointing them at
 * a page that always errors is worse. Showing them greyed keeps the shape of the real AWS
 * nav — so a user can see at a glance what exists in AWS and what this emulator covers —
 * while making it obvious the entry does nothing. The reason is on the tooltip.
 *
 * Every entry built this way should have a matching line in the completeness backlog in
 * planning/product-execution-plan.md.
 */
export function unavailableNavItem(text: string, reason: string): SideNavigationProps.Item {
  return {
    type: "link",
    href: UNAVAILABLE_HREF,
    // SideNavigation types `text` as a string but renders whatever node it is given, which
    // is the same escape hatch the global catalog nav uses to draw service icons.
    text: (
      <span
        title={`Not available in LCS — ${reason}`}
        style={{
          color: "var(--awsui-color-text-status-inactive, #8c8c94)",
          cursor: "not-allowed",
        }}
      >
        {text}
      </span>
    ) as unknown as string,
  };
}
