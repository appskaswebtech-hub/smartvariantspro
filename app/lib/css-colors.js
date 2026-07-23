/**
 * Swatch colour resolution, shared by the Customization preview.
 *
 * The storefront widget must resolve colours identically, but Liquid can't
 * import JS — so extensions/smart-variants-pro-widget/blocks/variant-selector.liquid
 * carries the same two lists inline. Keep the two in step when editing.
 */

/** The 148 CSS named colours. */
export const CSS_COLOR_NAMES = new Set([
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque",
  "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood",
  "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk",
  "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray",
  "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen",
  "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise",
  "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue",
  "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro",
  "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey",
  "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
  "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral",
  "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey",
  "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray",
  "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen",
  "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue",
  "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue",
  "mintcream", "mistyrose", "moccasin", "navajowhite", "navy", "oldlace",
  "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod",
  "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff",
  "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple", "red",
  "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen",
  "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray",
  "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle",
  "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow",
  "yellowgreen",
]);

/** Fallback colours for values that aren't colour names, picked by position. */
export const SWATCH_PALETTE = [
  "#5C6AC4",
  "#47C1BF",
  "#F49342",
  "#9C6ADE",
  "#50B83C",
  "#EEC200",
  "#DE3618",
  "#006FBB",
  "#E377C2",
  "#8C6E4B",
];

/** What a swatch shows. Mirrored in the Liquid's pv_content handling. */
export const SWATCH_CONTENTS = ["auto", "color", "name", "text"];

/** "Light Blue" -> "lightblue". Matches the Liquid's value slug so the admin
 * and storefront key per-value colours identically. */
export function slugify(name) {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]/g, "");
}

/**
 * Resolves a swatch colour for an option value. "Yellow" -> "yellow";
 * "Light Blue" -> "lightblue"; anything else -> a palette colour chosen by
 * the value's position, so it stays stable across reloads rather than
 * shuffling on every render.
 */
export function resolveSwatchColor(name, index) {
  const slug = slugify(name);
  if (CSS_COLOR_NAMES.has(slug)) return slug;
  return SWATCH_PALETTE[index % SWATCH_PALETTE.length];
}

/**
 * Auto content mode: colour-only when every value in the option is a colour
 * name, names otherwise. Decided per option rather than per value, so an
 * option can't end up half circles and half pills.
 */
export function autoSwatchContent(values) {
  const list = values ?? [];
  if (list.length === 0) return "name";
  const named = list.filter((value) => CSS_COLOR_NAMES.has(slugify(value)));
  return named.length === list.length ? "color" : "name";
}

/** Per-option override, falling back to the auto rule. */
export function resolveSwatchContent(content, values) {
  return !content || content === "auto" ? autoSwatchContent(values) : content;
}
