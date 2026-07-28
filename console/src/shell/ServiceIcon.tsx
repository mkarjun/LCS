import { findById, findByPath } from "@services/catalog";
import type { CatalogEntry } from "@services/catalog";
import { CATEGORY_COLORS, GLYPH_STROKE_WIDTH, glyphFor } from "./serviceGlyphs";

interface ServiceIconProps {
  /** Emulator service id, e.g. "s3". Either this or `entry` is required. */
  serviceId?: string;
  /** Route path, e.g. "opensearch", when only the path is known. */
  servicePath?: string;
  entry?: CatalogEntry;
  size?: number;
}

/**
 * Square, category-coloured service icon with an original pictogram.
 *
 * Resolves the catalog entry itself so callers can pass whichever identifier they have —
 * navigation has a path, search has an id, service pages have the entry.
 */
export function ServiceIcon({ serviceId, servicePath, entry, size = 24 }: ServiceIconProps) {
  const resolved =
    entry ??
    (serviceId !== undefined ? findById(serviceId) : undefined) ??
    (servicePath !== undefined ? findByPath(servicePath) : undefined);

  if (resolved === undefined) {
    return null;
  }

  const color = CATEGORY_COLORS[resolved.category];
  const glyph = glyphFor(resolved.id, resolved.category);
  const inset = Math.round(size * 0.16);

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
        borderRadius: Math.max(4, Math.round(size * 0.2)),
        background: color,
        // Keeps the mark visible against both the light and dark Cloudscape themes.
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)",
      }}
    >
      <svg
        width={size - inset * 2}
        height={size - inset * 2}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth={GLYPH_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={glyph} />
      </svg>
    </span>
  );
}
