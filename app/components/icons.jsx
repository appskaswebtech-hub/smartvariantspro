/**
 * Inline SVG line icons for the admin pages.
 *
 * Stroke-based, 24×24 viewBox, drawn with `currentColor` so the parent's text
 * `color` controls the icon color — white on the gradient heroes, accent-colored
 * in the AccentGroup chips. Kept dependency-free (no icon package) and in one
 * place so the set stays consistent. Paths follow the "lucide" line style.
 */

/* eslint-disable react/prop-types -- presentational icons; no prop-types dep */

function Svg({ size = 22, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
}

export function Palette(props) {
  return (
    <Svg {...props}>
      <path d="M12 3a9 9 0 1 0 0 18 2.5 2.5 0 0 0 2.5-2.5c0-.6-.24-1.15-.62-1.56-.4-.43-.63-1-.63-1.62A2.32 2.32 0 0 1 15.5 13H17a4 4 0 0 0 4-4c0-3.31-4.03-6-9-6Z" />
      <circle cx="7.5" cy="10.5" r="1.1" />
      <circle cx="9.5" cy="6.75" r="1.1" />
      <circle cx="14.25" cy="6.75" r="1.1" />
      <circle cx="16.75" cy="10.5" r="1.1" />
    </Svg>
  );
}

export function Layout(props) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 9h18M9 21V9" />
    </Svg>
  );
}

export function Droplet(props) {
  return (
    <Svg {...props}>
      <path d="M12 2.5c3.2 3.5 6.5 6.6 6.5 10.5a6.5 6.5 0 0 1-13 0C5.5 9.1 8.8 6 12 2.5Z" />
    </Svg>
  );
}

export function Sliders(props) {
  return (
    <Svg {...props}>
      <path d="M4 6h8M18 6h2M4 12h10M20 12h0M4 18h2M12 18h8" />
      <circle cx="15" cy="6" r="2.25" />
      <circle cx="17" cy="12" r="2.25" />
      <circle cx="9" cy="18" r="2.25" />
    </Svg>
  );
}

export function Layers(props) {
  return (
    <Svg {...props}>
      <path d="M12 2.5 2.5 7 12 11.5 21.5 7 12 2.5Z" />
      <path d="m2.5 12 9.5 4.5 9.5-4.5" />
      <path d="m2.5 17 9.5 4.5 9.5-4.5" />
    </Svg>
  );
}

export function Sparkles(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.5c.5 2.9 1.6 4 4.5 4.5-2.9.5-4 1.6-4.5 4.5-.5-2.9-1.6-4-4.5-4.5 2.9-.5 4-1.6 4.5-4.5Z" />
      <path d="M18.5 13.5c.3 1.5.8 2 2.3 2.3-1.5.3-2 .8-2.3 2.3-.3-1.5-.8-2-2.3-2.3 1.5-.3 2-.8 2.3-2.3Z" />
      <path d="M6 15c.2 1 .5 1.3 1.5 1.5-1 .2-1.3.5-1.5 1.5-.2-1-.5-1.3-1.5-1.5 1-.2 1.3-.5 1.5-1.5Z" />
    </Svg>
  );
}

export function Rocket(props) {
  return (
    <Svg {...props}>
      <path d="M12 15c-1-.4-1.9-1-2.7-1.8-.8-.8-1.4-1.7-1.8-2.7A12.9 12.9 0 0 1 15.5 2.5c2.7 0 5 .8 6 1.5.1.2.5 3.3-1.5 6A12.9 12.9 0 0 1 12 15Z" />
      <path d="M9.2 13.2 6 12c.3-1.6 1-3.1 2-4 1.1-1 3-1 3-1" />
      <path d="M10.8 14.8 12 18c1.6-.3 3.1-1 4-2 1-1.1 1-3 1-3" />
      <path d="M5 16c-1.2 1-1.6 4-1.6 4s3-.4 4-1.6c.6-.7.6-1.7-.1-2.4a1.7 1.7 0 0 0-2.3 0Z" />
      <circle cx="15" cy="9" r="1.4" />
    </Svg>
  );
}

export function Gear(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </Svg>
  );
}

export function Lightbulb(props) {
  return (
    <Svg {...props}>
      <path d="M9 18h6" />
      <path d="M10 21.5h4" />
      <path d="M15 14.5c.2-1 .7-1.8 1.5-2.6A5.5 5.5 0 1 0 7.5 12c.8.7 1.3 1.5 1.5 2.5" />
    </Svg>
  );
}

/* eslint-enable react/prop-types */
