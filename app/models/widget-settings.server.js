const METAFIELD_NAMESPACE = "smart_variants_pro";
const METAFIELD_KEY = "settings";

const CURRENT_APP_INSTALLATION_QUERY = `#graphql
  query CurrentAppInstallation {
    currentAppInstallation {
      id
    }
  }`;

const SYNC_WIDGET_SETTINGS_MUTATION = `#graphql
  mutation SyncWidgetSettings($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }`;

const OPTION_NAMES_QUERY = `#graphql
  query ShopProductOptionNames($cursor: String) {
    products(first: 250, after: $cursor) {
      nodes {
        options {
          name
          optionValues { name }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;

// Sample values kept per option name, purely to render the admin preview.
const MAX_SAMPLE_VALUES = 5;

// Bounds the option-name scan so a large catalog can't spin the loader.
const MAX_OPTION_NAME_PAGES = 20;

// Per-product override metafield: namespace is the app-reserved "$app",
// key "variant_ui". Declared in shopify.app.toml.
const PRODUCT_METAFIELD_NAMESPACE = "$app";
const PRODUCT_METAFIELD_KEY = "variant_ui";
export const PRODUCTS_PER_PAGE = 20;

const PRODUCT_OVERRIDES_QUERY = `#graphql
  query ProductVariantUiOverrides($first: Int, $last: Int, $after: String, $before: String) {
    products(first: $first, last: $last, after: $after, before: $before, sortKey: TITLE) {
      nodes {
        id
        title
        featuredImage { url altText }
        options { name optionValues { name } }
        variantUi: metafield(namespace: "$app", key: "variant_ui") { jsonValue }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }`;

/**
 * One page of products with their current per-product style overrides, for
 * the Customization page's product list.
 */
export async function fetchProductOverrides(admin, { cursor, dir } = {}) {
  // first/after and last/before are mutually exclusive in the Admin API.
  const variables =
    dir === "prev" && cursor
      ? { first: null, after: null, last: PRODUCTS_PER_PAGE, before: cursor }
      : { first: PRODUCTS_PER_PAGE, after: cursor || null, last: null, before: null };

  const response = await admin.graphql(PRODUCT_OVERRIDES_QUERY, { variables });
  const json = await response.json();
  const products = json.data?.products;

  return {
    items: products?.nodes ?? [],
    pageInfo: products?.pageInfo ?? null,
  };
}

/**
 * Writes a product's style overrides to its app-owned metafield, which the
 * theme app extension reads as product.metafields["$app"].variant_ui.value.
 * An empty optionStyles map means "no overrides - follow the store-wide styles".
 * optionContents is a parallel map of swatch content modes, kept on its own
 * key so existing saved option_styles keep working untouched. optionColors is a
 * per-value colour map ({ optionKey: { valueSlug: "#rrggbb" } }) on its own key.
 */
export async function syncProductOverride(
  admin,
  { productId, optionStyles, optionContents = {}, optionColors = {} },
) {
  const response = await admin.graphql(SYNC_WIDGET_SETTINGS_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: productId,
          namespace: PRODUCT_METAFIELD_NAMESPACE,
          key: PRODUCT_METAFIELD_KEY,
          type: "json",
          value: JSON.stringify({
            option_styles: optionStyles,
            option_swatch_content: optionContents,
            option_swatch_colors: optionColors,
          }),
        },
      ],
    },
  });
  const json = await response.json();
  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join("; "));
  }
}

/**
 * Records which of a product's options supplies the variant price, so the
 * Variants editor can restore the flag on reload. Stored on its own key
 * rather than inside variant_ui, which the Customization page rewrites
 * wholesale. An empty optionName clears the flag.
 */
export async function syncPriceOption(admin, { productId, optionName }) {
  const response = await admin.graphql(SYNC_WIDGET_SETTINGS_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: productId,
          namespace: PRODUCT_METAFIELD_NAMESPACE,
          key: "price_option",
          type: "single_line_text_field",
          value: optionName ?? "",
        },
      ],
    },
  });
  const json = await response.json();
  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join("; "));
  }
}

/**
 * Collects the distinct variant option names used across the shop's
 * products, with a few sample values each for the admin preview.
 * Skips Shopify's implicit "Title" option (products without real options).
 */
export async function fetchShopOptionNames(admin) {
  const seen = new Map(); // lowercased key -> { key, name, values }
  let cursor = null;
  let pages = 0;

  do {
    const response = await admin.graphql(OPTION_NAMES_QUERY, {
      variables: { cursor },
    });
    const json = await response.json();
    const products = json.data?.products;
    if (!products) break;

    for (const node of products.nodes) {
      for (const option of node.options ?? []) {
        const name = (option.name ?? "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (key === "title") continue;
        if (seen.has(key)) continue;
        seen.set(key, {
          key,
          name,
          values: (option.optionValues ?? [])
            .map((value) => value.name)
            .filter(Boolean)
            .slice(0, MAX_SAMPLE_VALUES),
        });
      }
    }

    cursor = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null;
    pages += 1;
  } while (cursor && pages < MAX_OPTION_NAME_PAGES);

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse a JSON string field from ShopSetting; {} when empty/invalid. */
function safeParseObject(value) {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Publishes the FULL widget settings to the app-data metafield the theme app
 * extension reads via {{ app.metafields.smart_variants_pro.settings.value }}.
 * `setting` is a ShopSetting row (the single source of truth) — both the
 * Settings and Customization pages call this after saving, so the metafield
 * always mirrors the complete row and neither page clobbers the other's keys.
 * optionStyles/optionContents are JSON strings in the DB, so they're parsed.
 */
export async function publishWidgetMetafield(admin, setting = {}) {
  const ownerResponse = await admin.graphql(CURRENT_APP_INSTALLATION_QUERY);
  const ownerJson = await ownerResponse.json();
  const ownerId = ownerJson.data?.currentAppInstallation?.id;
  if (!ownerId) {
    throw new Error("Could not resolve the current app installation");
  }

  const response = await admin.graphql(SYNC_WIDGET_SETTINGS_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId,
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_KEY,
          type: "json",
          value: JSON.stringify({
            layout: setting.widgetLayout ?? "radio",
            theme_color: setting.themeColor ?? "#111111",
            option_styles: safeParseObject(setting.optionStyles),
            option_swatch_content: safeParseObject(setting.optionContents),
            show_quantity: setting.showQuantity ?? true,
            show_add_to_cart: setting.showAddToCart ?? true,
            add_to_cart_label: setting.addToCartLabel ?? "Add to cart",
            show_price: setting.showPrice ?? true,
            show_availability: setting.showAvailability ?? true,
          }),
        },
      ],
    },
  });
  const json = await response.json();
  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join("; "));
  }
}
