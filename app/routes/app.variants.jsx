import { useEffect, useState } from "react";
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { syncPriceOption } from "../models/widget-settings.server";
import {
  assignVariantImage,
  clearVariantImage,
  uploadProductImage,
} from "../models/variant-media.server";
import { ACCENTS, PageHero, withAlpha } from "../components/PageDecor";
import { Layers } from "../components/icons";
import { resolveSwatchColor, SWATCH_PALETTE } from "../lib/css-colors";

const MAX_VARIANTS = 2048;
const MAX_OPTIONS = 3;
const SYNC_LIMIT = 100; // productSet runs synchronously up to 100 variants.
const PRODUCTS_PER_PAGE = 25;
// The list query's variants(first: 20) is kept small so the whole query stays
// under Shopify's 1000-point cost cap: 25 x 20 is roughly 525 points.

const PRODUCT_LIST_QUERY = `#graphql
  query ListProductsWithVariants($first: Int, $last: Int, $after: String, $before: String) {
    products(first: $first, last: $last, after: $after, before: $before, sortKey: TITLE) {
      nodes {
        id
        title
        featuredImage { url altText }
        options { name }
        variantsCount { count }
        variants(first: 20) {
          nodes { id title price sku availableForSale }
        }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }`;

const PRODUCT_QUERY = `#graphql
  query GetProductForVariants($id: ID!, $cursor: String) {
    product(id: $id) {
      id
      title
      handle
      hasOnlyDefaultVariant
      featuredMedia { ... on MediaImage { image { url } } }
      priceOption: metafield(namespace: "$app", key: "price_option") { value }
      options {
        id
        name
        position
        optionValues { id name }
      }
      variants(first: 250, after: $cursor) {
        nodes {
          id
          title
          price
          sku
          selectedOptions { name value }
          media(first: 1) {
            nodes { id ... on MediaImage { image { url } } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

const PRODUCT_SET_MUTATION = `#graphql
  mutation SetProductVariants($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(synchronous: $synchronous, input: $input) {
      product { id }
      productSetOperation { id status }
      userErrors { field message }
    }
  }`;

const PRODUCT_OPERATION_QUERY = `#graphql
  query GetProductOperation($id: ID!) {
    productOperation(id: $id) {
      ... on ProductSetOperation {
        id
        status
        product { id }
        userErrors { field message }
      }
    }
  }`;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const operationId = url.searchParams.get("operationId");
  const productId = url.searchParams.get("productId");

  // Status poll for an asynchronous productSet operation.
  if (operationId) {
    const response = await admin.graphql(PRODUCT_OPERATION_QUERY, {
      variables: { id: operationId },
    });
    const json = await response.json();
    const operation = json.data?.productOperation;
    return {
      shop: session.shop,
      product: null,
      operationStatus: operation?.status ?? null,
      operationErrors: operation?.userErrors ?? [],
    };
  }

  // No product selected: list the catalog so every product and its variants
  // are browsable without picking one first.
  if (!productId) {
    const cursor = url.searchParams.get("cursor");
    const dir = url.searchParams.get("dir");
    // first/after and last/before are mutually exclusive in the Admin API.
    const variables =
      dir === "prev" && cursor
        ? { first: null, after: null, last: PRODUCTS_PER_PAGE, before: cursor }
        : { first: PRODUCTS_PER_PAGE, after: cursor || null, last: null, before: null };

    const response = await admin.graphql(PRODUCT_LIST_QUERY, { variables });
    const json = await response.json();
    const products = json.data?.products;

    return {
      shop: session.shop,
      product: null,
      productList: {
        items: products?.nodes ?? [],
        pageInfo: products?.pageInfo ?? null,
      },
    };
  }

  // Load all variants (up to MAX_VARIANTS) by paginating the connection.
  let cursor = null;
  let product = null;
  const nodes = [];
  do {
    const response = await admin.graphql(PRODUCT_QUERY, {
      variables: { id: productId, cursor },
    });
    const json = await response.json();
    product = json.data?.product ?? null;
    if (!product) break;
    nodes.push(...product.variants.nodes);
    cursor = product.variants.pageInfo.hasNextPage
      ? product.variants.pageInfo.endCursor
      : null;
  } while (cursor && nodes.length < MAX_VARIANTS);

  if (product) {
    // A product with no real variants carries only Shopify's implicit
    // "Title / Default Title" option. Start the editor blank rather than
    // surfacing it as an auto-generated "Option 1".
    const defaultOnly = product.hasOnlyDefaultVariant;
    product = {
      id: product.id,
      title: product.title,
      handle: product.handle,
      defaultImage: product.featuredMedia?.image?.url ?? null,
      options: defaultOnly ? [] : product.options,
      variants: { nodes: defaultOnly ? [] : nodes },
    };
  }

  return { shop: session.shop, product };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const productId = String(formData.get("productId") || "");
  const intent = String(formData.get("intent") || "");

  // Per-variant image upload/remove, decoupled from the productSet save below:
  // both target an existing variant id, so the variant must already be saved.
  if (intent === "uploadVariantImage") {
    const variantId = String(formData.get("variantId") || "");
    const file = formData.get("file");
    if (!productId || !variantId || typeof file === "string" || !file) {
      return { intent, ok: false, error: "Missing image." };
    }
    try {
      const { mediaId } = await uploadProductImage(admin, {
        productId,
        filename: file.name || "variant-image",
        mimeType: file.type || "image/jpeg",
        fileSize: file.size,
        bytes: await file.arrayBuffer(),
      });
      const { imageUrl } = await assignVariantImage(admin, {
        productId,
        variantId,
        mediaId,
      });
      return { intent, ok: true, variantId, mediaId, imageUrl };
    } catch (error) {
      console.error("Variant image upload failed", error);
      return { intent, ok: false, variantId, error: "Upload failed." };
    }
  }

  if (intent === "removeVariantImage") {
    const variantId = String(formData.get("variantId") || "");
    const mediaId = String(formData.get("mediaId") || "");
    if (!productId || !variantId || !mediaId) {
      return { intent, ok: false, error: "Missing image." };
    }
    try {
      await clearVariantImage(admin, { productId, variantId, mediaId });
      return { intent, ok: true, variantId };
    } catch (error) {
      console.error("Variant image remove failed", error);
      return { intent, ok: false, variantId, error: "Remove failed." };
    }
  }

  let payload;
  try {
    payload = JSON.parse(String(formData.get("payload") || "{}"));
  } catch {
    return { mode: "sync", ok: false, userErrors: [{ message: "Invalid form data." }] };
  }

  const { options = [], variants = [] } = payload;

  const input = {
    id: productId,
    productOptions: options.map((option, index) => ({
      name: option.name,
      position: index + 1,
      values: option.values.map((name) => ({ name })),
    })),
    variants: variants.map((variant) => ({
      ...(variant.id ? { id: variant.id } : {}),
      optionValues: variant.options.map((name, index) => ({
        optionName: options[index].name,
        name,
      })),
      price: variant.price ? String(variant.price) : "0",
      ...(variant.sku ? { sku: variant.sku } : {}),
    })),
  };

  const synchronous = variants.length <= SYNC_LIMIT;

  const response = await admin.graphql(PRODUCT_SET_MUTATION, {
    variables: { input, synchronous },
  });
  const json = await response.json();
  const result = json.data?.productSet;
  const userErrors = result?.userErrors ?? [];

  // Errors surface immediately in either mode.
  if (userErrors.length > 0) {
    return { mode: "sync", ok: false, userErrors };
  }

  // Only once the save is accepted, so a failed save can't leave a stale flag.
  // Independent of the async operation, so it runs for both modes.
  try {
    await syncPriceOption(admin, {
      productId,
      optionName: String(formData.get("priceOption") || ""),
    });
  } catch (error) {
    console.error("Price option metafield sync failed", error);
  }

  if (synchronous) {
    return { mode: "sync", ok: true, userErrors: [] };
  }

  return { mode: "async", operationId: result?.productSetOperation?.id ?? null };
};

function cartesian(lists) {
  return lists.reduce(
    (acc, list) => acc.flatMap((combo) => list.map((value) => [...combo, value])),
    [[]],
  );
}

/** "$10" -> "10.00", "1,250.50" -> "1250.50", "Small" -> null. */
function parseMoney(raw) {
  const cleaned = String(raw ?? "")
    .replace(/[^\d.,-]/g, "")
    .replace(/,/g, "");
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) && num >= 0 ? num.toFixed(2) : null;
}

export default function Variants() {
  const { product, productList } = useLoaderData();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const statusFetcher = useFetcher();
  const imageFetcher = useFetcher();
  const revalidator = useRevalidator();
  const [, setSearchParams] = useSearchParams();
  const [expanded, setExpanded] = useState(() => new Set());

  const [options, setOptions] = useState([]);
  const [variants, setVariants] = useState([]);
  const [draftValues, setDraftValues] = useState({});
  const [warning, setWarning] = useState("");
  const [operationId, setOperationId] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // variantKey currently uploading -> local object URL shown optimistically.
  const [uploadingImages, setUploadingImages] = useState({});

  const isSubmitting = fetcher.state !== "idle";
  const isPolling = Boolean(operationId);
  const busy = isSubmitting || isPolling;

  const pollUrl = operationId
    ? `/app/variants?operationId=${encodeURIComponent(operationId)}`
    : null;

  // Sync local editing state from the loaded product.
  useEffect(() => {
    if (!product) {
      setOptions([]);
      setVariants([]);
      return;
    }
    const savedPriceOption = product.priceOption?.value ?? "";
    const opts = [...product.options]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({
        id: o.id,
        name: o.name,
        values: o.optionValues.map((v) => v.name),
        isPrice: Boolean(savedPriceOption) && o.name === savedPriceOption,
      }));
    setOptions(opts);
    setVariants(
      product.variants.nodes.map((node) => ({
        id: node.id,
        options: opts.map((o) => {
          const match = node.selectedOptions.find((s) => s.name === o.name);
          return match ? match.value : "";
        }),
        price: node.price ?? "",
        sku: node.sku ?? "",
        imageUrl: node.media?.nodes?.[0]?.image?.url ?? null,
        mediaId: node.media?.nodes?.[0]?.id ?? null,
        key: node.id,
      })),
    );
    setWarning("");
  }, [product]);

  // Handle the save fetcher result (sync success or start of async polling).
  useEffect(() => {
    if (fetcher.data?.mode === "async" && fetcher.data.operationId) {
      setOperationId(fetcher.data.operationId);
    }
    if (fetcher.data?.mode === "sync" && fetcher.data.ok) {
      setSaveSuccess(true);
      shopify.toast.show("Variants saved");
    }
  }, [fetcher.data, shopify]);

  // Kick off polling when an operation id arrives.
  useEffect(() => {
    if (operationId && pollUrl) {
      statusFetcher.load(pollUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId]);

  // React to each poll result and schedule the next poll until complete.
  useEffect(() => {
    if (!operationId) return;
    const data = statusFetcher.data;
    if (!data) return;

    if ((data.operationErrors ?? []).length > 0) {
      setOperationId(null);
      return;
    }
    if (data.operationStatus === "COMPLETE") {
      setOperationId(null);
      setSaveSuccess(true);
      shopify.toast.show("Variants saved");
      revalidator.revalidate();
      return;
    }
    const timer = setTimeout(() => statusFetcher.load(pollUrl), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFetcher.data]);

  const toggleExpanded = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const pickProduct = async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      action: "select",
    });
    if (selection && selection[0]) {
      setSaveSuccess(false);
      setSearchParams({ productId: selection[0].id });
    }
  };

  const editInAdmin = () => {
    shopify.intents.invoke?.("edit:shopify/Product", { value: product.id });
  };

  // --- Options editing ---
  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    setOptions([...options, { id: null, name: "", values: [], isPrice: false }]);
  };

  /**
   * Marks one option as the price source (at most one), and re-derives prices
   * for the variants already on screen so the toggle pays off immediately.
   * Unticking leaves prices as they are, editable again.
   */
  const setPriceOption = (index, checked) => {
    const next = options.map((o, i) => ({ ...o, isPrice: checked && i === index }));
    setOptions(next);
    setWarning("");
    if (!checked) return;
    setVariants(
      variants.map((v) => {
        const derived = parseMoney(v.options[index]);
        return derived === null ? v : { ...v, price: derived };
      }),
    );
  };

  const renameOption = (index, name) => {
    setOptions(options.map((o, i) => (i === index ? { ...o, name } : o)));
  };

  const removeOption = (index) => {
    setOptions(options.filter((_, i) => i !== index));
  };

  const addValue = (index) => {
    const value = (draftValues[index] || "").trim();
    if (!value) return;
    setOptions(
      options.map((o, i) =>
        i === index && !o.values.includes(value)
          ? { ...o, values: [...o.values, value] }
          : o,
      ),
    );
    setDraftValues({ ...draftValues, [index]: "" });
  };

  const removeValue = (optionIndex, valueIndex) => {
    setOptions(
      options.map((o, i) =>
        i === optionIndex
          ? { ...o, values: o.values.filter((_, vi) => vi !== valueIndex) }
          : o,
      ),
    );
  };

  // --- Variant generation & editing ---
  const generateVariants = () => {
    if (options.length === 0 || options.some((o) => o.values.length === 0)) {
      setWarning("Add at least one value to every option before generating.");
      return;
    }
    const combos = cartesian(options.map((o) => o.values));
    if (combos.length > MAX_VARIANTS) {
      setWarning(
        `That configuration would create ${combos.length} variants. The limit is ${MAX_VARIANTS}. Remove some option values.`,
      );
      return;
    }
    const existing = new Map(variants.map((v) => [v.options.join("||"), v]));
    const priceIndex = options.findIndex((o) => o.isPrice);
    const unparseable = new Set();

    setVariants(
      combos.map((combo) => {
        const key = combo.join("||");
        const prior = existing.get(key);
        const base = prior
          ? { ...prior, options: combo }
          : { id: null, options: combo, price: "", sku: "", key };
        if (priceIndex < 0) return base;

        // The derived price must win over any price carried over from a
        // previous generation, otherwise a stale hand-typed value sticks.
        const derived = parseMoney(combo[priceIndex]);
        if (derived === null) {
          unparseable.add(combo[priceIndex]);
          return { ...base, price: "" };
        }
        return { ...base, price: derived };
      }),
    );

    if (unparseable.size > 0) {
      const names = Array.from(unparseable, (v) => `"${v}"`).join(", ");
      setWarning(
        `${names} in ${options[priceIndex].name} ${unparseable.size === 1 ? "isn't a price" : "aren't prices"} — those variants need one.`,
      );
    } else {
      setWarning("");
    }
  };

  const updateVariant = (index, field, value) => {
    setVariants(
      variants.map((v, i) => (i === index ? { ...v, [field]: value } : v)),
    );
  };

  const removeVariant = (index) => {
    setVariants(variants.filter((_, i) => i !== index));
  };

  const uploadVariantImage = (variant, file) => {
    if (!file || !variant.id) return;
    // Show the picked file straight away while Shopify processes the upload.
    const previewUrl = URL.createObjectURL(file);
    setUploadingImages((prev) => ({ ...prev, [variant.key]: previewUrl }));
    const formData = new FormData();
    formData.append("intent", "uploadVariantImage");
    formData.append("productId", product.id);
    formData.append("variantId", variant.id);
    formData.append("file", file);
    imageFetcher.submit(formData, {
      method: "POST",
      encType: "multipart/form-data",
    });
  };

  const removeVariantImage = (variant) => {
    if (!variant.id || !variant.mediaId) return;
    const formData = new FormData();
    formData.append("intent", "removeVariantImage");
    formData.append("productId", product.id);
    formData.append("variantId", variant.id);
    formData.append("mediaId", variant.mediaId);
    imageFetcher.submit(formData, { method: "POST" });
  };

  // Fold an image upload/remove result back into variant state.
  useEffect(() => {
    const data = imageFetcher.data;
    if (!data || (data.intent !== "uploadVariantImage" && data.intent !== "removeVariantImage"))
      return;
    if (!data.ok) {
      shopify.toast.show(data.error || "Image update failed");
    } else if (data.intent === "uploadVariantImage") {
      shopify.toast.show("Variant image updated");
      setVariants((prev) =>
        prev.map((v) =>
          v.id === data.variantId
            ? { ...v, imageUrl: data.imageUrl ?? v.imageUrl, mediaId: data.mediaId }
            : v,
        ),
      );
    } else {
      shopify.toast.show("Variant image removed");
      setVariants((prev) =>
        prev.map((v) =>
          v.id === data.variantId ? { ...v, imageUrl: null, mediaId: null } : v,
        ),
      );
    }
    // Clear any optimistic preview for the affected variant.
    setUploadingImages((prev) => {
      const next = { ...prev };
      for (const [key, url] of Object.entries(next)) {
        const match = variants.find((v) => v.key === key);
        if (match && match.id === data.variantId) {
          URL.revokeObjectURL(url);
          delete next[key];
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageFetcher.data]);

  const save = () => {
    if (variants.length === 0) {
      setWarning("Generate at least one variant before saving.");
      return;
    }
    if (variants.length > MAX_VARIANTS) {
      setWarning(`You can save at most ${MAX_VARIANTS} variants.`);
      return;
    }
    setWarning("");
    setSaveSuccess(false);
    setPendingCount(variants.length);
    const formData = new FormData();
    formData.append("productId", product.id);
    formData.append("priceOption", options.find((o) => o.isPrice)?.name ?? "");
    formData.append(
      "payload",
      JSON.stringify({
        options: options.map((o) => ({ name: o.name, values: o.values })),
        variants: variants.map((v) => ({
          id: v.id,
          options: v.options,
          price: v.price,
          sku: v.sku,
        })),
      }),
    );
    fetcher.submit(formData, { method: "POST" });
  };

  const overLimit = variants.length > MAX_VARIANTS;
  const errors = [
    ...(fetcher.data?.mode === "sync" ? fetcher.data.userErrors ?? [] : []),
    ...(statusFetcher.data?.operationErrors ?? []),
  ];

  const priceIndex = options.findIndex((o) => o.isPrice);

  // Rendered from both the Options and Pricing sections, so it takes the
  // option's real index to keep the existing index-based handlers working.
  const renderOptionCard = (option, oi) => (
    <s-box key={oi} padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-text-field
            label={`Option ${oi + 1} name`}
            value={option.name}
            placeholder="e.g. Size"
            onChange={(e) => renameOption(oi, e.target.value)}
          />
          <s-button variant="tertiary" onClick={() => removeOption(oi)}>
            Remove option
          </s-button>
        </s-stack>

        {option.values.length > 0 && (
          <s-stack direction="inline" gap="small">
            {option.values.map((value, vi) => (
              <s-box
                key={vi}
                padding="small-200"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-text>{value}</s-text>
                  <s-button
                    variant="tertiary"
                    onClick={() => removeValue(oi, vi)}
                    accessibilityLabel={`Remove ${value}`}
                  >
                    ×
                  </s-button>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}

        <s-stack direction="inline" gap="base" alignItems="end">
          <s-text-field
            label="Add value"
            value={draftValues[oi] || ""}
            placeholder={option.isPrice ? "e.g. $10" : "e.g. Small"}
            onChange={(e) =>
              setDraftValues({ ...draftValues, [oi]: e.target.value })
            }
          />
          <s-button variant="secondary" onClick={() => addValue(oi)}>
            Add value
          </s-button>
        </s-stack>

        <s-checkbox
          label="This option sets the price"
          checked={option.isPrice}
          onChange={(e) => setPriceOption(oi, e.target.checked)}
        />
      </s-stack>
    </s-box>
  );

  // Each variant as a color-coded card. The accent cycles through the shared
  // swatch palette so rows read as distinct; the swatch dots are derived from
  // the variant's own option values (resolveSwatchColor), so a "Black" value
  // shows a black dot and non-colour values get a stable palette dot.
  const DANGER = SWATCH_PALETTE[6]; // #DE3618
  const renderVariantCard = (variant, vi) => {
    const accent = SWATCH_PALETTE[vi % SWATCH_PALETTE.length];
    return (
      <div
        key={variant.key}
        style={{
          background: withAlpha(accent, 0.05),
          border: "1px solid #e3e3e3",
          borderLeft: `4px solid ${accent}`,
          borderRadius: "12px",
          padding: "16px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <span style={{ display: "inline-flex", gap: "4px", flexShrink: 0 }}>
              {variant.options.map((value, idx) => (
                <span
                  key={idx}
                  title={value}
                  style={{
                    width: "14px",
                    height: "14px",
                    borderRadius: "50%",
                    background: resolveSwatchColor(value, idx),
                    border: "1px solid rgba(0,0,0,0.15)",
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.4)",
                  }}
                />
              ))}
            </span>
            <span
              style={{
                fontWeight: 600,
                fontSize: "14px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {variant.options.join(" / ")}
            </span>
          </div>
          <button
            type="button"
            aria-label="Remove variant"
            onClick={() => removeVariant(vi)}
            style={{
              flexShrink: 0,
              appearance: "none",
              border: "none",
              background: "transparent",
              color: DANGER,
              fontSize: "13px",
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: "8px",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = withAlpha(DANGER, 0.1);
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            Remove
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "12px",
          }}
        >
          <div>
            <span
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: accent,
                marginBottom: "4px",
              }}
            >
              Price
            </span>
            <s-money-field
              label="Price"
              labelAccessibilityVisibility="exclusive"
              value={variant.price}
              {...(priceIndex >= 0 ? { readOnly: true } : {})}
              onChange={(e) => updateVariant(vi, "price", e.target.value)}
            />
          </div>
          <div>
            <span
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: accent,
                marginBottom: "4px",
              }}
            >
              SKU
            </span>
            <s-text-field
              label="SKU"
              labelAccessibilityVisibility="exclusive"
              value={variant.sku}
              onChange={(e) => updateVariant(vi, "sku", e.target.value)}
            />
          </div>
        </div>

        {renderVariantImage(variant, accent)}
      </div>
    );
  };

  // Image control per variant. A variant must be saved (has an id) before an
  // image can be attached, since assignment targets the variant id. The
  // thumbnail falls back to the product's default image.
  const renderVariantImage = (variant, accent) => {
    const isSaved = Boolean(variant.id);
    const hasCustom = Boolean(variant.mediaId);
    const thumbUrl =
      uploadingImages[variant.key] || variant.imageUrl || product.defaultImage;
    return (
      <div
        style={{
          marginTop: "12px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            flexShrink: 0,
            borderRadius: "8px",
            border: "1px solid #e3e3e3",
            background: "#fff",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <span style={{ fontSize: "10px", color: "#8c9196" }}>No image</span>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: accent,
              marginBottom: "4px",
            }}
          >
            Image
          </span>
          {isSaved ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: accent,
                  cursor: "pointer",
                }}
              >
                {hasCustom ? "Replace image" : "Upload image"}
                <input
                  type="file"
                  accept="image/*"
                  style={{
                    position: "absolute",
                    width: "1px",
                    height: "1px",
                    padding: 0,
                    margin: "-1px",
                    overflow: "hidden",
                    clip: "rect(0 0 0 0)",
                    border: 0,
                  }}
                  onChange={(e) => {
                    uploadVariantImage(variant, e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {hasCustom && (
                <button
                  type="button"
                  onClick={() => removeVariantImage(variant)}
                  style={{
                    appearance: "none",
                    border: "none",
                    background: "transparent",
                    color: DANGER,
                    fontSize: "13px",
                    fontWeight: 600,
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ) : (
            <s-text color="subdued">Save to add an image.</s-text>
          )}
        </div>
      </div>
    );
  };

  if (!product) {
    const items = productList?.items ?? [];
    const pageInfo = productList?.pageInfo ?? null;

    return (
      <s-page heading="Products">
        <s-button slot="primary-action" variant="primary" onClick={pickProduct}>
          Select product
        </s-button>

        <PageHero
          title="Products"
          subtitle="Pick a product to build its size, color, and style combinations."
          icon={Layers}
          from={ACCENTS.teal}
          to={ACCENTS.blue}
        />

        <s-section heading="All products">
          {items.length === 0 ? (
            <s-box
              padding="large"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="base" alignItems="center">
                <s-icon type="product" />
                <s-heading>No products found</s-heading>
                <s-paragraph>
                  This store has no products yet. Create one, then add up to{" "}
                  {MAX_VARIANTS} variants here.
                </s-paragraph>
                <s-button variant="primary" onClick={pickProduct}>
                  Select product
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <s-stack direction="block" gap="base">
              {items.map((item) => {
                const isOpen = expanded.has(item.id);
                const shown = item.variants.nodes;
                const total = item.variantsCount?.count ?? shown.length;
                const optionNames = item.options.map((o) => o.name).join(" / ");

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
                              {optionNames || "No options"}
                            </s-text>
                          </s-stack>
                        </s-stack>

                        <s-stack direction="inline" gap="small" alignItems="center">
                          <s-badge tone="info">{total} variants</s-badge>
                          <s-button
                            variant="tertiary"
                            onClick={() => toggleExpanded(item.id)}
                          >
                            {isOpen ? "Hide variants" : "Show variants"}
                          </s-button>
                          <s-button
                            variant="secondary"
                            onClick={() => setSearchParams({ productId: item.id })}
                          >
                            Edit
                          </s-button>
                        </s-stack>
                      </s-stack>

                      {isOpen && (
                        <s-stack direction="block" gap="small">
                          {shown.length === 0 ? (
                            <s-text color="subdued">
                              This product has no variants yet.
                            </s-text>
                          ) : (
                            <s-table variant="list">
                              <s-table-header-row>
                                <s-table-header>Variant</s-table-header>
                                <s-table-header>Price</s-table-header>
                                <s-table-header>SKU</s-table-header>
                              </s-table-header-row>
                              <s-table-body>
                                {shown.map((variant) => (
                                  <s-table-row key={variant.id}>
                                    <s-table-cell>{variant.title}</s-table-cell>
                                    <s-table-cell>{variant.price}</s-table-cell>
                                    <s-table-cell>{variant.sku || "—"}</s-table-cell>
                                  </s-table-row>
                                ))}
                              </s-table-body>
                            </s-table>
                          )}
                          {total > shown.length && (
                            <s-text color="subdued">
                              Showing first {shown.length} of {total} — choose
                              Edit to see all.
                            </s-text>
                          )}
                        </s-stack>
                      )}
                    </s-stack>
                  </s-box>
                );
              })}

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="secondary"
                  disabled={!pageInfo?.hasPreviousPage}
                  onClick={() =>
                    setSearchParams({ cursor: pageInfo.startCursor, dir: "prev" })
                  }
                >
                  Previous
                </s-button>
                <s-button
                  variant="secondary"
                  disabled={!pageInfo?.hasNextPage}
                  onClick={() =>
                    setSearchParams({ cursor: pageInfo.endCursor, dir: "next" })
                  }
                >
                  Next
                </s-button>
              </s-stack>
            </s-stack>
          )}
        </s-section>

        <s-section slot="aside" heading="How it works">
          <s-paragraph>
            Every product in your store is listed here. Choose{" "}
            <s-text type="strong">Show variants</s-text> to see a product&apos;s
            variants, or <s-text type="strong">Edit</s-text> to add and change
            them — up to {MAX_VARIANTS} per product.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Products">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        disabled={overLimit || busy}
        {...(busy ? { loading: true } : {})}
      >
        Save
      </s-button>

      <PageHero
        title={product.title}
        subtitle="Build and manage this product's variant combinations."
        icon={Layers}
        from={ACCENTS.teal}
        to={ACCENTS.blue}
      />

      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-stack direction="block" gap="small">
            <s-heading>{product.title}</s-heading>
            <s-badge tone={overLimit ? "critical" : "info"}>
              {variants.length} / {MAX_VARIANTS} variants
            </s-badge>
          </s-stack>
          <s-stack direction="inline" gap="small">
            <s-button variant="tertiary" onClick={editInAdmin}>
              Edit in admin
            </s-button>
            <s-button variant="secondary" onClick={pickProduct} disabled={busy}>
              Change product
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {isPolling && (
        <s-banner tone="info" heading="Saving variants">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-spinner />
            <s-text>
              Saving {pendingCount} variants… this can take a moment for large
              sets.
            </s-text>
          </s-stack>
        </s-banner>
      )}
      {saveSuccess && !isPolling && (
        <s-banner tone="success" heading="Variants saved" />
      )}
      {errors.length > 0 && (
        <s-banner tone="critical" heading="Couldn't save variants">
          <s-unordered-list>
            {errors.map((error, i) => (
              <s-list-item key={i}>{error.message}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}
      {warning && <s-banner tone="warning" heading={warning} />}

      <s-section heading="Options">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Product properties like Size or Color. These are combined together
            to make each variant.
          </s-text>

          {options.every((o) => o.isPrice) && options.length > 0 && (
            <s-text color="subdued">
              No property options yet — add one to combine with your pricing
              option.
            </s-text>
          )}

          {options.map((option, oi) =>
            option.isPrice ? null : renderOptionCard(option, oi),
          )}

          <s-stack direction="inline" gap="base">
            {options.length < MAX_OPTIONS && (
              <s-button variant="secondary" onClick={addOption}>
                Add option
              </s-button>
            )}
            <s-button variant="primary" onClick={generateVariants}>
              Generate variants
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {priceIndex >= 0 && (
        <s-section heading="Pricing">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              Set aside from your product properties. Each value fills the
              variant&apos;s price automatically, so you never type a price.
            </s-text>
            {renderOptionCard(options[priceIndex], priceIndex)}
          </s-stack>
        </s-section>
      )}

      <s-section heading="Variants">
        {variants.length === 0 ? (
          <s-paragraph>
            No variants yet. Add options and values above, then choose{" "}
            <s-text type="strong">Generate variants</s-text>.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {priceIndex >= 0 && (
              <s-text color="subdued">
                Price comes from {options[priceIndex].name} — untick it under
                Pricing to set prices by hand.
              </s-text>
            )}
            <div style={{ display: "grid", gap: "12px" }}>
              {variants.map((variant, vi) => renderVariantCard(variant, vi))}
            </div>
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          Define your options (like Size or Color), add their values, then
          generate every combination as a variant. Edit price and SKU inline and
          save — up to {MAX_VARIANTS} variants per product (Shopify&apos;s maximum).
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
