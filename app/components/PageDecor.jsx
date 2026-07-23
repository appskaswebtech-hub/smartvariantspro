/**
 * Presentational decoration for the admin pages.
 *
 * Polaris web components (s-page, s-section, s-select, …) render with the
 * admin's own design tokens and ignore custom CSS, so color has to live in
 * plain HTML wrapped around them with inline styles — the same approach the
 * Customization preview already uses. These helpers keep that styling in one
 * place so every page stays consistent.
 *
 * Accent colors are pulled from SWATCH_PALETTE so the admin's accents match the
 * storefront swatch palette shoppers see.
 */
import { SWATCH_PALETTE } from "../lib/css-colors";

/* eslint-disable react/prop-types -- presentational helpers; no prop-types dep */

// Named accents drawn from the shared storefront palette.
export const ACCENTS = {
  indigo: SWATCH_PALETTE[0], // #5C6AC4
  teal: SWATCH_PALETTE[1], //   #47C1BF
  orange: SWATCH_PALETTE[2], // #F49342
  violet: SWATCH_PALETTE[3], // #9C6ADE
  green: SWATCH_PALETTE[4], //  #50B83C
  gold: SWATCH_PALETTE[5], //   #EEC200
  blue: SWATCH_PALETTE[7], //   #006FBB
};

/** A hex color at the given alpha (0-1) as an 8-digit hex string. */
export function withAlpha(hex, alpha) {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/**
 * Full-width gradient banner shown at the top of a page's main column. The
 * page keeps its s-page heading (admin title bar / breadcrumb); this is an
 * in-page banner that carries the color.
 */
export function PageHero({
  title,
  subtitle,
  icon: Icon,
  from = ACCENTS.indigo,
  to = ACCENTS.violet,
}) {
  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${from}, ${to})`,
        color: "#ffffff",
        borderRadius: "16px",
        padding: "24px 28px",
        marginBottom: "20px",
        boxShadow: `0 8px 24px ${withAlpha(from, 0.28)}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        {Icon && (
          <span
            aria-hidden="true"
            style={{
              color: "#ffffff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "48px",
              height: "48px",
              flexShrink: 0,
              borderRadius: "12px",
              background: "rgba(255,255,255,0.18)",
            }}
          >
            <Icon size={26} />
          </span>
        )}
        <div style={{ display: "grid", gap: "4px" }}>
          <span style={{ fontSize: "20px", fontWeight: 700, lineHeight: 1.2 }}>
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: "13px", opacity: 0.92, lineHeight: 1.4 }}>
              {subtitle}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A colored icon chip + title over a softly tinted, left-accented card. Wraps
 * a group of Polaris controls; the controls keep their own names and behavior.
 */
export function AccentGroup({ color = ACCENTS.indigo, icon: Icon, title, children }) {
  return (
    <div style={{ marginBottom: "4px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "10px",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            flexShrink: 0,
            borderRadius: "8px",
            background: withAlpha(color, 0.16),
          }}
        >
          {Icon && <Icon size={18} />}
        </span>
        <span style={{ fontSize: "14px", fontWeight: 600, color: "inherit" }}>
          {title}
        </span>
      </div>
      <div
        style={{
          background: withAlpha(color, 0.07),
          borderLeft: `4px solid ${color}`,
          borderRadius: "10px",
          padding: "16px",
          display: "grid",
          gap: "16px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** A soft tinted card used to frame the storefront preview. */
export function PreviewCard({ color = ACCENTS.teal, children }) {
  return (
    <div
      style={{
        background: `linear-gradient(160deg, ${withAlpha(color, 0.1)}, ${withAlpha(
          ACCENTS.violet,
          0.08,
        )})`,
        border: `1px solid ${withAlpha(color, 0.25)}`,
        borderRadius: "14px",
        padding: "18px",
      }}
    >
      {children}
    </div>
  );
}

/* eslint-enable react/prop-types */
