import type { ServiceCategory } from "@services/catalog";

/**
 * Service icon.
 *
 * Deliberately NOT AWS's own service icons. The AWS Architecture Icons are licensed
 * separately from the SDKs and Cloudscape, and their terms restrict redistribution and
 * modification — shipping them inside a third-party emulator's console would be a
 * trademark and licensing problem, not a parity win. Cloudscape (Apache 2.0) ships no
 * service icons either.
 *
 * Instead each service gets a tile whose colour comes from its AWS category, which is how
 * the AWS console groups services. That keeps navigation scannable and colour-coded
 * without copying protected assets.
 */
const CATEGORY_COLORS: Record<ServiceCategory, string> = {
  Analytics: "#8C4FFF",
  "Application Integration": "#E7157B",
  "Business Applications": "#DD344C",
  "Cloud Financial Management": "#00A4A6",
  Compute: "#ED7100",
  Containers: "#ED7100",
  Database: "#2E27AD",
  "Developer Tools": "#3334B9",
  "Front-end Web & Mobile": "#E7157B",
  "Machine Learning": "#01A88D",
  "Management & Governance": "#E7157B",
  "Networking & Content Delivery": "#8C4FFF",
  "Security, Identity, & Compliance": "#DD344C",
  Storage: "#7AA116",
};

interface ServiceIconProps {
  category: ServiceCategory;
  shortName: string;
  size?: number;
}

/** Up to two initials, so "Step Functions" reads "SF" and "S3" stays "S3". */
function initials(shortName: string): string {
  const compact = shortName.replace(/[^A-Za-z0-9 ]/g, "").trim();
  const words = compact.split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ServiceIcon({ category, shortName, size = 24 }: ServiceIconProps) {
  const color = CATEGORY_COLORS[category];
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        minWidth: size,
        borderRadius: Math.max(4, size * 0.18),
        background: color,
        color: "#ffffff",
        fontSize: size * 0.42,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        fontFamily: "inherit",
      }}
    >
      {initials(shortName)}
    </span>
  );
}
