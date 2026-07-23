import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchProductOverrides,
  fetchShopOptionNames,
  syncProductOverride,
  syncWidgetMetafield,
} from "../models/widget-settings.server";
import {
  SWATCH_CONTENTS,
  resolveSwatchColor,
  resolveSwatchContent,
  slugify,
} from "../lib/css-colors";
import {
  ACCENTS,
  AccentGroup,
  PageHero,
  PreviewCard,
} from "../components/PageDecor";
import { Droplet, Layout, Palette, Sliders } from "../components/icons";

const LAYOUTS = ["dropdown", "swatches", "radio"];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const DEFAULTS = {
  widgetLayout: "radio",
  themeColor: "#111111",
};

function cleanOptionStyles(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  const clean = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (LAYOUTS.includes(value)) clean[key] = value;
  }
  return clean;
}

function cleanOptionContents(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  const clean = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (SWATCH_CONTENTS.includes(value)) clean[key] = value;
  }
  return clean;
}

function parseOptionStyles(raw) {
  try {
    return cleanOptionStyles(JSON.parse(raw ?? "{}"));
  } catch {
    return {};
  }
}

function parseOptionContents(raw) {
  try {
    return cleanOptionContents(JSON.parse(raw ?? "{}"));
  } catch {
    return {};
  }
}

/**
 * Validates a nested per-value colour map { optionKey: { valueSlug: "#rrggbb" } },
 * dropping anything that isn't a 6-digit hex. Mirrors cleanOptionContents.
 */
function cleanOptionColors(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  const clean = {};
  for (const [key, valueMap] of Object.entries(parsed)) {
    if (!valueMap || typeof valueMap !== "object") continue;
    const inner = {};
    for (const [slug, hex] of Object.entries(valueMap)) {
      if (typeof hex === "string" && HEX_RE.test(hex)) inner[slug] = hex.toLowerCase();
    }
    if (Object.keys(inner).length > 0) clean[key] = inner;
  }
  return clean;
}

/**
 * Normalises any CSS colour to a `#rrggbb` hex so an <input type="color"> can
 * display it — resolveSwatchColor returns colour names ("black") as well as
 * palette hexes, and the colour input only accepts hex. Uses a detached canvas
 * to resolve names; guards SSR (no document) with a neutral default.
 */
function toHexColor(color) {
  if (typeof color === "string" && HEX_RE.test(color)) return color.toLowerCase();
  if (typeof document === "undefined") return "#cccccc";
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.fillStyle = "#cccccc";
  ctx.fillStyle = color; // invalid values are ignored, leaving the default
  return ctx.fillStyle;
}

/**
 * An admin-side approximation of the storefront widget. Mirrors the shapes in
 * extensions/product-variants-widget/assets/variant-selector.css rather than
 * importing it, so treat it as a guide, not a pixel-exact render.
 */
/* eslint-disable react/prop-types -- presentational helper; this project has no prop-types dep */
function VariantPreview({
  options,
  resolveStyle,
  resolveContent,
  resolveColor,
  themeColor,
  showAddToCart,
}) {
  const border = "1px solid #dcdcdc";

  if (options.length === 0) {
    return <s-text color="subdued">No options to preview yet.</s-text>;
  }

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      {options.map((option) => {
        const style = resolveStyle(option.key);
        const values = option.values.length > 0 ? option.values : ["Sample"];
        const content = resolveContent(option.key, values);

        return (
          <div key={option.key}>
            <div style={{ fontWeight: 600, marginBottom: "6px", fontSize: "13px" }}>
              {option.name}
            </div>

            {style === "dropdown" && (
              <select
                defaultValue={values[0]}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border,
                  borderRadius: "8px",
                  background: "transparent",
                  fontSize: "13px",
                }}
              >
                {values.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            )}

            {style === "radio" && (
              <div style={{ display: "grid", gap: "8px" }}>
                {values.map((value, index) => (
                  <label
                    key={value}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        position: "relative",
                        width: "16px",
                        height: "16px",
                        flexShrink: 0,
                        borderRadius: "50%",
                        border: `2px solid ${index === 0 ? themeColor : "#dcdcdc"}`,
                        display: "inline-block",
                      }}
                    >
                      {index === 0 && (
                        <span
                          style={{
                            position: "absolute",
                            inset: "2px",
                            borderRadius: "50%",
                            background: themeColor,
                          }}
                        />
                      )}
                    </span>
                    {value}
                  </label>
                ))}
              </div>
            )}

            {style !== "dropdown" && style !== "radio" && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  alignItems: "center",
                }}
              >
                {values.map((value, index) => {
                  const selected = index === 0;

                  // Colour only: the circle is the control; hovering reveals
                  // the name, matching the storefront's title tooltip.
                  if (content === "color") {
                    return (
                      <span
                        key={value}
                        title={value}
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          border,
                          background: resolveColor(option.key, value, index),
                          outline: selected ? `2px solid ${themeColor}` : "none",
                          outlineOffset: "2px",
                        }}
                      />
                    );
                  }

                  // Name inside: a circle that stretches to a pill so longer
                  // values aren't clipped.
                  if (content === "name") {
                    return (
                      <span
                        key={value}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: "40px",
                          minWidth: "40px",
                          padding: "0 12px",
                          fontSize: "13px",
                          borderRadius: "999px",
                          border: selected ? `1px solid ${themeColor}` : border,
                          boxShadow: selected
                            ? `0 0 0 1px ${themeColor} inset`
                            : "none",
                        }}
                      >
                        {value}
                      </span>
                    );
                  }

                  return (
                    <span
                      key={value}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "6px 10px",
                        fontSize: "13px",
                        borderRadius: "8px",
                        border: selected ? `1px solid ${themeColor}` : border,
                        boxShadow: selected
                          ? `0 0 0 1px ${themeColor} inset`
                          : "none",
                      }}
                    >
                      {value}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {showAddToCart ? (
        <button
          type="button"
          style={{
            padding: "10px 16px",
            border: "none",
            borderRadius: "8px",
            background: themeColor,
            color: "#ffffff",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "default",
          }}
        >
          Add to cart
        </button>
      ) : (
        <s-text color="subdued">
          Your theme&apos;s Add to cart button is used.
        </s-text>
      )}
    </div>
  );
}
/* eslint-enable react/prop-types */

/** Builds a validated { optionKey: style } map from paired form fields. */
function optionStylesFromForm(formData) {
  const keys = formData.getAll("optionKey").map(String);
  const styles = formData.getAll("optionStyle").map(String);
  const optionStyles = {};
  keys.forEach((key, index) => {
    const style = styles[index];
    if (key && LAYOUTS.includes(style)) optionStyles[key] = style;
  });
  return optionStyles;
}

/** Same index-pairing, for the per-option swatch content mode. */
function optionContentsFromForm(formData) {
  const keys = formData.getAll("optionKey").map(String);
  const contents = formData.getAll("optionContent").map(String);
  const optionContents = {};
  keys.forEach((key, index) => {
    const content = contents[index];
    // "auto" is the default, so storing it would just be noise.
    if (key && content && content !== "auto" && SWATCH_CONTENTS.includes(content)) {
      optionContents[key] = content;
    }
  });
  return optionContents;
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const setting = await prisma.shopSetting.findUnique({
    where: { shop: session.shop },
  });

  const widgetLayout = LAYOUTS.includes(setting?.widgetLayout)
    ? setting.widgetLayout
    : DEFAULTS.widgetLayout;
  const themeColor = HEX_RE.test(setting?.themeColor ?? "")
    ? setting.themeColor
    : DEFAULTS.themeColor;
  const optionStyles = parseOptionStyles(setting?.optionStyles);
  const optionContents = parseOptionContents(setting?.optionContents);
  const optionNames = await fetchShopOptionNames(admin);
  const productOverrides = await fetchProductOverrides(admin, {
    cursor: url.searchParams.get("cursor"),
    dir: url.searchParams.get("dir"),
  });

  return {
    settings: {
      widgetLayout,
      themeColor,
      // Columns default to true, so an unsaved shop keeps today's rendering.
      showQuantity: setting?.showQuantity ?? true,
      showAddToCart: setting?.showAddToCart ?? true,
    },
    optionStyles,
    optionContents,
    optionNames,
    productOverrides,
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  // Per-product overrides live on the product's own metafield, so they save
  // independently of the store-wide settings below.
  if (formData.get("intent") === "product") {
    const productId = String(formData.get("productId") || "");
    if (!productId) {
      return { ok: false, synced: false, scope: "product" };
    }
    const optionStyles = optionStylesFromForm(formData);
    const optionContents = optionContentsFromForm(formData);
    let parsedColors = {};
    try {
      parsedColors = JSON.parse(String(formData.get("optionColors") || "{}"));
    } catch {
      parsedColors = {};
    }
    const optionColors = cleanOptionColors(parsedColors);
    try {
      await syncProductOverride(admin, {
        productId,
        optionStyles,
        optionContents,
        optionColors,
      });
    } catch (error) {
      console.error("Product override sync failed", error);
      return { ok: true, synced: false, scope: "product", productId };
    }
    return { ok: true, synced: true, scope: "product", productId };
  }

  const requestedLayout = String(formData.get("widgetLayout") || "");
  const widgetLayout = LAYOUTS.includes(requestedLayout)
    ? requestedLayout
    : DEFAULTS.widgetLayout;

  const requestedColor = String(
    formData.get("themeColor") || DEFAULTS.themeColor,
  ).trim();
  const themeColor = HEX_RE.test(requestedColor)
    ? requestedColor.toLowerCase()
    : DEFAULTS.themeColor;

  const optionStyles = optionStylesFromForm(formData);
  const optionContents = optionContentsFromForm(formData);
  const showQuantity = formData.get("showQuantity") !== "false";
  const showAddToCart = formData.get("showAddToCart") !== "false";

  const values = {
    widgetLayout,
    themeColor,
    optionStyles: JSON.stringify(optionStyles),
    optionContents: JSON.stringify(optionContents),
    showQuantity,
    showAddToCart,
  };

  await prisma.shopSetting.upsert({
    where: { shop: session.shop },
    update: values,
    create: { shop: session.shop, ...values },
  });

  try {
    await syncWidgetMetafield(admin, {
      widgetLayout,
      themeColor,
      optionStyles,
      optionContents,
      showQuantity,
      showAddToCart,
    });
  } catch (error) {
    console.error("Widget settings metafield sync failed", error);
    return { ok: true, synced: false, scope: "global" };
  }

  return { ok: true, synced: true, scope: "global" };
};

export default function Customization() {
  const { settings, optionStyles, optionContents, optionNames, productOverrides } =
    useLoaderData();
  const fetcher = useFetcher();
  const productFetcher = useFetcher();
  const shopify = useAppBridge();
  const [, setSearchParams] = useSearchParams();
  const [themeColor, setThemeColor] = useState(settings.themeColor);
  // Single-open accordion: the expanded product is the one being previewed.
  const [expandedId, setExpandedId] = useState(null);
  const [globalPreview, setGlobalPreview] = useState({
    layout: settings.widgetLayout,
    optionStyles,
    optionContents,
    showAddToCart: settings.showAddToCart,
  });
  const [productStyles, setProductStyles] = useState({});
  const [productContents, setProductContents] = useState({});
  const [productColors, setProductColors] = useState({});

  const defaultLayoutLabel = {
    dropdown: "Dropdown",
    swatches: "Swatches",
    radio: "Radio buttons",
  }[settings.widgetLayout];

  const isSaving =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const isSavingProduct =
    ["loading", "submitting"].includes(productFetcher.state) &&
    productFetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(
        fetcher.data.synced
          ? "Customization saved"
          : "Saved, but storefront sync failed — save again to retry",
      );
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (!productFetcher.data) return;
    if (!productFetcher.data.ok) {
      shopify.toast.show("Couldn't save this product's styles");
    } else {
      shopify.toast.show(
        productFetcher.data.synced
          ? "Product styles saved"
          : "Save failed — try again",
      );
    }
  }, [productFetcher.data, shopify]);

  const save = () => {
    const form = document.getElementById("customization-form");
    if (!form) return;
    const formData = new FormData(form);
    fetcher.submit(formData, { method: "POST" });
  };

  const saveProduct = (productId) => {
    const form = document.getElementById(`product-form-${productId}`);
    if (!form) return;
    productFetcher.submit(new FormData(form), { method: "POST" });
  };

  const toggleExpanded = (id) => {
    setProductStyles({});
    setProductContents({});
    const item = productOverrides.items.find((i) => i.id === id);
    setProductColors(
      cleanOptionColors(item?.variantUi?.jsonValue?.option_swatch_colors),
    );
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // Records an explicit per-value colour pick for the expanded product.
  const setColor = (key, slug, hex) =>
    setProductColors((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [slug]: hex },
    }));

  // The s-* selects are uncontrolled, so rather than rely on per-element
  // onChange firing through custom elements, listen on the form itself and
  // re-read FormData — the same mechanism that already saves correctly.
  useEffect(() => {
    const form = document.getElementById("customization-form");
    if (!form) return;
    const sync = () => {
      const formData = new FormData(form);
      setGlobalPreview({
        layout: String(formData.get("widgetLayout") || settings.widgetLayout),
        optionStyles: optionStylesFromForm(formData),
        optionContents: optionContentsFromForm(formData),
        showAddToCart: formData.get("showAddToCart") !== "false",
      });
    };
    form.addEventListener("change", sync);
    form.addEventListener("input", sync);
    return () => {
      form.removeEventListener("change", sync);
      form.removeEventListener("input", sync);
    };
  }, [settings.widgetLayout]);

  useEffect(() => {
    if (!expandedId) return;
    const form = document.getElementById(`product-form-${expandedId}`);
    if (!form) return;
    const sync = () => {
      const formData = new FormData(form);
      setProductStyles(optionStylesFromForm(formData));
      setProductContents(optionContentsFromForm(formData));
    };
    sync();
    form.addEventListener("change", sync);
    form.addEventListener("input", sync);
    return () => {
      form.removeEventListener("change", sync);
      form.removeEventListener("input", sync);
    };
  }, [expandedId]);

  // The preview follows whichever product is expanded, else the store-wide
  // settings — so these resolvers mirror the Liquid chains against that scope.
  const previewProduct = expandedId
    ? productOverrides.items.find((item) => item.id === expandedId)
    : null;

  // Mirrors the Liquid chain: product override > store-wide > default.
  const resolveStyle = (key) =>
    (previewProduct ? productStyles[key] : undefined) ??
    globalPreview.optionStyles[key] ??
    globalPreview.layout;

  // Mirrors the Liquid chain: product override > store-wide > auto rule.
  const resolveContent = (key, values) =>
    resolveSwatchContent(
      (previewProduct ? productContents[key] : undefined) ??
        globalPreview.optionContents[key],
      values,
    );

  // Per-value colour: an explicit product pick wins, else the auto rule.
  const resolveColor = (key, value, index) =>
    (previewProduct ? productColors[key]?.[slugify(value)] : undefined) ||
    resolveSwatchColor(value, index);

  const previewOptions = previewProduct
    ? previewProduct.options
        .filter((o) => o.name.toLowerCase() !== "title")
        .map((o) => ({
          key: o.name.toLowerCase(),
          name: o.name,
          values: (o.optionValues ?? []).map((v) => v.name).slice(0, 5),
        }))
    : optionNames;

  return (
    <s-page heading="Customization" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(isSaving ? { loading: true } : {})}
      >
        Save
      </s-button>

      <PageHero
        title="Customization"
        subtitle="Style the storefront variant selector — see changes live as you edit."
        icon={Palette}
        from={ACCENTS.indigo}
        to={ACCENTS.violet}
      />

      {/* Our own two-column row rather than Polaris's aside slot: the sticky
          preview needs a parent we control that is as tall as the settings
          column, which a slotted element never gets. alignItems:flex-start
          matters — a stretched flex item is as tall as the row and can't stick. */}
      <div
        style={{
          display: "flex",
          gap: "20px",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            flex: "1 1 480px",
            minWidth: 0,
            display: "grid",
            gap: "16px",
          }}
        >
      <s-section heading="Variant selector">
        {fetcher.data?.ok && fetcher.data.synced === false && (
          <s-banner tone="warning" heading="Storefront sync failed">
            <s-paragraph>
              Your settings were saved, but publishing them to the storefront
              failed. Save again to retry.
            </s-paragraph>
          </s-banner>
        )}

        <fetcher.Form method="post" id="customization-form">
          <div style={{ display: "grid", gap: "20px" }}>
            <AccentGroup color={ACCENTS.indigo} icon={Layout} title="Display">
              <s-select
                label="Default display style"
                name="widgetLayout"
                value={settings.widgetLayout}
                details="Used for any option without its own style set below."
              >
                <s-option value="dropdown">Dropdown</s-option>
                <s-option value="swatches">Swatches</s-option>
                <s-option value="radio">Radio buttons</s-option>
              </s-select>

              <s-select
                label="Quantity selector"
                name="showQuantity"
                value={settings.showQuantity ? "true" : "false"}
                details="Hide it to use your theme's own quantity selector instead."
              >
                <s-option value="true">Shown</s-option>
                <s-option value="false">Hidden</s-option>
              </s-select>

              <s-select
                label="Add to cart button"
                name="showAddToCart"
                value={settings.showAddToCart ? "true" : "false"}
                details="Hide it to use your theme's own button — the widget will keep your theme's cart form pointed at the variant shoppers pick here."
              >
                <s-option value="true">Shown</s-option>
                <s-option value="false">Hidden</s-option>
              </s-select>
            </AccentGroup>

            <AccentGroup color={ACCENTS.violet} icon={Droplet} title="Colors">
              <s-stack direction="block" gap="small-200">
                <s-text>Theme color</s-text>
                <s-stack direction="inline" gap="base" alignItems="center">
                  <input
                    type="color"
                    name="themeColor"
                    value={themeColor}
                    onChange={(event) => setThemeColor(event.target.value)}
                    aria-label="Theme color"
                    style={{
                      width: "44px",
                      height: "32px",
                      padding: 0,
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  />
                  <s-text color="subdued">{themeColor}</s-text>
                </s-stack>
                <s-text color="subdued">
                  Used for the selected option, radio dot, and add to cart
                  button.
                </s-text>
              </s-stack>
            </AccentGroup>

            <AccentGroup color={ACCENTS.green} icon={Sliders} title="Style per option">
              {optionNames.length === 0 ? (
                <s-text color="subdued">
                  No product options found yet. Add options on the Products
                  page, then set a style for each here.
                </s-text>
              ) : (
                optionNames.map((option) => {
                  // Resolve the live style so the swatch-content control tracks
                  // the dropdown before saving: per-option style, else default.
                  const style =
                    globalPreview.optionStyles[option.key] ??
                    globalPreview.layout;
                  const isSwatches = style === "swatches";
                  return (
                    <s-stack key={option.key} direction="block" gap="small">
                      <input type="hidden" name="optionKey" value={option.key} />
                      <s-select
                        label={option.name}
                        name="optionStyle"
                        value={optionStyles[option.key] ?? "default"}
                      >
                        <s-option value="default">
                          Default ({defaultLayoutLabel})
                        </s-option>
                        <s-option value="dropdown">Dropdown</s-option>
                        <s-option value="swatches">Swatches</s-option>
                        <s-option value="radio">Radio buttons</s-option>
                      </s-select>

                      {/* optionContent must be emitted for every option, even
                          when hidden: the action pairs it with optionKey by
                          index, so a gap would shift values onto the wrong
                          option. */}
                      {isSwatches ? (
                        <s-select
                          label={`${option.name} swatch content`}
                          name="optionContent"
                          value={optionContents[option.key] ?? "auto"}
                        >
                          <s-option value="auto">
                            Auto (colour if colour names)
                          </s-option>
                          <s-option value="color">Colour only</s-option>
                          <s-option value="name">Name inside</s-option>
                          <s-option value="text">Plain text</s-option>
                        </s-select>
                      ) : (
                        <input
                          type="hidden"
                          name="optionContent"
                          value={optionContents[option.key] ?? "auto"}
                        />
                      )}
                    </s-stack>
                  );
                })
              )}
            </AccentGroup>

            <s-stack direction="inline" gap="base">
              <s-button
                type="button"
                variant="primary"
                onClick={save}
                {...(isSaving ? { loading: true } : {})}
              >
                Save
              </s-button>
            </s-stack>
          </div>
        </fetcher.Form>
      </s-section>

      <s-section heading="Per-product overrides">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            The styles above apply to every product. Give a single product its
            own styles here and they take priority for that product only.
          </s-text>

          {productOverrides.items.length === 0 ? (
            <s-text color="subdued">No products found in this store.</s-text>
          ) : (
            <>
              {productOverrides.items.map((item) => {
                const isOpen = expandedId === item.id;
                const overrides = cleanOptionStyles(
                  item.variantUi?.jsonValue?.option_styles,
                );
                const savedContents = cleanOptionContents(
                  item.variantUi?.jsonValue?.option_swatch_content,
                );
                const savedColors = cleanOptionColors(
                  item.variantUi?.jsonValue?.option_swatch_colors,
                );
                const hasOverrides =
                  Object.keys(overrides).length > 0 ||
                  Object.keys(savedContents).length > 0 ||
                  Object.keys(savedColors).length > 0;
                // Products without real variants carry an implicit "Title"
                // option, which has nothing to style.
                const styleable = item.options.filter(
                  (o) => o.name.toLowerCase() !== "title",
                );

                return (
                  <s-box
                    key={item.id}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                  >
                    <s-stack direction="block" gap="base">
                      <s-stack
                        direction="inline"
                        gap="base"
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <s-stack direction="inline" gap="base" alignItems="center">
                          {item.featuredImage?.url && (
                            <img
                              src={item.featuredImage.url}
                              alt={item.featuredImage.altText || ""}
                              width="40"
                              height="40"
                              style={{
                                objectFit: "cover",
                                borderRadius: "6px",
                                display: "block",
                              }}
                            />
                          )}
                          <s-stack direction="block" gap="small-200">
                            <s-text type="strong">{item.title}</s-text>
                            <s-text color="subdued">
                              {styleable.map((o) => o.name).join(" / ") ||
                                "No options"}
                            </s-text>
                          </s-stack>
                        </s-stack>

                        <s-stack direction="inline" gap="small" alignItems="center">
                          <s-badge tone={hasOverrides ? "success" : "info"}>
                            {hasOverrides ? "Custom" : "Store default"}
                          </s-badge>
                          <s-button
                            variant="tertiary"
                            disabled={styleable.length === 0}
                            onClick={() => toggleExpanded(item.id)}
                          >
                            {isOpen ? "Close" : "Customize"}
                          </s-button>
                        </s-stack>
                      </s-stack>

                      {isOpen && (
                        <productFetcher.Form
                          method="post"
                          id={`product-form-${item.id}`}
                        >
                          <input type="hidden" name="intent" value="product" />
                          <input type="hidden" name="productId" value={item.id} />
                          {/* Whole per-value colour map for this product, kept
                              as one JSON field since the count varies by option. */}
                          <input
                            type="hidden"
                            name="optionColors"
                            value={JSON.stringify(productColors)}
                          />
                          <s-stack direction="block" gap="base">
                            {styleable.length === 0 ? (
                              <s-text color="subdued">
                                This product has no options to style.
                              </s-text>
                            ) : (
                              styleable.map((option) => {
                                const key = option.name.toLowerCase();
                                const isSwatches = resolveStyle(key) === "swatches";
                                const values = (option.optionValues ?? []).map(
                                  (v) => v.name,
                                );
                                const isColor =
                                  isSwatches &&
                                  resolveContent(key, values) === "color";
                                return (
                                  <s-stack key={key} direction="block" gap="small">
                                    <input
                                      type="hidden"
                                      name="optionKey"
                                      value={key}
                                    />
                                    <s-select
                                      label={option.name}
                                      name="optionStyle"
                                      value={overrides[key] ?? "default"}
                                    >
                                      <s-option value="default">
                                        Default (store-wide)
                                      </s-option>
                                      <s-option value="dropdown">Dropdown</s-option>
                                      <s-option value="swatches">Swatches</s-option>
                                      <s-option value="radio">
                                        Radio buttons
                                      </s-option>
                                    </s-select>

                                    {/* optionContent must be emitted for every
                                        option, even when hidden: the action
                                        pairs it with optionKey by index, so a
                                        gap here would shift values onto the
                                        wrong option. */}
                                    {isSwatches ? (
                                      <s-select
                                        label={`${option.name} swatch content`}
                                        name="optionContent"
                                        value={savedContents[key] ?? "auto"}
                                      >
                                        <s-option value="auto">
                                          Auto (colour if colour names)
                                        </s-option>
                                        <s-option value="color">
                                          Colour only
                                        </s-option>
                                        <s-option value="name">
                                          Name inside
                                        </s-option>
                                        <s-option value="text">Plain text</s-option>
                                      </s-select>
                                    ) : (
                                      <input
                                        type="hidden"
                                        name="optionContent"
                                        value={savedContents[key] ?? "auto"}
                                      />
                                    )}

                                    {isColor && values.length > 0 && (
                                      <s-stack direction="block" gap="small-200">
                                        <s-text color="subdued">
                                          {option.name} colours — click a swatch
                                          to set an exact colour.
                                        </s-text>
                                        <div
                                          style={{
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: "12px",
                                          }}
                                        >
                                          {values.map((value, i) => {
                                            const slug = slugify(value);
                                            const current =
                                              productColors[key]?.[slug] ??
                                              toHexColor(
                                                resolveSwatchColor(value, i),
                                              );
                                            return (
                                              <label
                                                key={slug}
                                                style={{
                                                  display: "inline-flex",
                                                  alignItems: "center",
                                                  gap: "6px",
                                                  fontSize: "13px",
                                                }}
                                              >
                                                <input
                                                  type="color"
                                                  value={current}
                                                  aria-label={`${value} colour`}
                                                  onChange={(e) =>
                                                    setColor(
                                                      key,
                                                      slug,
                                                      e.target.value,
                                                    )
                                                  }
                                                  style={{
                                                    width: "32px",
                                                    height: "32px",
                                                    padding: 0,
                                                    border: "1px solid #ccc",
                                                    borderRadius: "6px",
                                                    cursor: "pointer",
                                                  }}
                                                />
                                                {value}
                                              </label>
                                            );
                                          })}
                                        </div>
                                      </s-stack>
                                    )}
                                  </s-stack>
                                );
                              })
                            )}

                            {styleable.length > 0 && (
                              <s-stack direction="inline" gap="base">
                                <s-button
                                  type="button"
                                  variant="primary"
                                  onClick={() => saveProduct(item.id)}
                                  {...(isSavingProduct ? { loading: true } : {})}
                                >
                                  Save {item.title}
                                </s-button>
                              </s-stack>
                            )}
                          </s-stack>
                        </productFetcher.Form>
                      )}
                    </s-stack>
                  </s-box>
                );
              })}

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="secondary"
                  disabled={!productOverrides.pageInfo?.hasPreviousPage}
                  onClick={() =>
                    setSearchParams({
                      cursor: productOverrides.pageInfo.startCursor,
                      dir: "prev",
                    })
                  }
                >
                  Previous
                </s-button>
                <s-button
                  variant="secondary"
                  disabled={!productOverrides.pageInfo?.hasNextPage}
                  onClick={() =>
                    setSearchParams({
                      cursor: productOverrides.pageInfo.endCursor,
                      dir: "next",
                    })
                  }
                >
                  Next
                </s-button>
              </s-stack>
            </>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Live on your storefront">
        <s-paragraph>
          Saving publishes these settings to your online store right away —
          the variant widget picks them up automatically. The app block&apos;s
          settings in the theme editor act as fallbacks until you save here
          for the first time.
        </s-paragraph>
      </s-section>
        </div>

        {/* Sticky column: the Preview alone, so the pinned card always fits
            on screen. */}
        <div
          style={{
            flex: "1 1 300px",
            minWidth: 0,
            maxWidth: "380px",
            position: "sticky",
            top: "12px",
          }}
        >
          <s-section heading="Preview">
            <s-stack direction="block" gap="base">
              <s-text color="subdued">
                {previewProduct ? previewProduct.title : "All products"}
              </s-text>
              <PreviewCard>
                <VariantPreview
                  options={previewOptions}
                  resolveStyle={resolveStyle}
                  resolveContent={resolveContent}
                  resolveColor={resolveColor}
                  themeColor={themeColor}
                  showAddToCart={globalPreview.showAddToCart}
                />
              </PreviewCard>
              <s-text color="subdued">
                An approximation of the storefront widget — updates as you
                change settings, before you save.
              </s-text>
            </s-stack>
          </s-section>
        </div>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
