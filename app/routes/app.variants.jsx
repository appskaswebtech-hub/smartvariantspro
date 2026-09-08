/* eslint-disable react/prop-types */
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
import {
  bulkUpdateVariants,
  deleteVariants,
  addImageToVariants,
  removeImageFromVariants,
  removeVariantImagesByIds,
  resolveProductVariantIds,
  listPublications,
  setProductPublishing,
} from "../models/variant-bulk.server";
import {
  setVariantQuantities,
  setVariantQuantitiesByOptions,
} from "../models/inventory.server";
import { COUNTRIES } from "../lib/countries";
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
        hasOnlyDefaultVariant
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
          barcode
          inventoryPolicy
          inventoryQuantity
          inventoryItem {
            countryCodeOfOrigin
            requiresShipping
            measurement { weight { value unit } }
          }
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
    const publications = await listPublications(admin).catch(() => []);

    return {
      shop: session.shop,
      product: null,
      publications,
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

  // Sales channels for the "Manage publishing" bulk action.
  const publications = await listPublications(admin).catch(() => []);

  return { shop: session.shop, product, publications };
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

  // Inline-quantity sync after a Save: keyed by option combo so it applies to
  // brand-new variants too. Fired by the client once the variants exist.
  if (intent === "syncStock") {
    let quantitiesByKey;
    try {
      quantitiesByKey = JSON.parse(String(formData.get("quantities") || "{}"));
    } catch {
      return { intent, ok: false, userErrors: [{ message: "Invalid data." }] };
    }
    try {
      const { userErrors } = await setVariantQuantitiesByOptions(admin, {
        productId,
        quantitiesByKey,
      });
      return { intent, ok: userErrors.length === 0, userErrors };
    } catch (error) {
      console.error("Stock sync failed", error);
      return { intent, ok: false, userErrors: [{ message: error.message || "Stock sync failed." }] };
    }
  }

  // --- Bulk actions on selected (already-saved) variants ---
  if (intent === "bulkUpdate") {
    const field = String(formData.get("field") || "");
    let entries;
    try {
      entries = JSON.parse(String(formData.get("entries") || "[]"));
    } catch {
      return { intent, ok: false, userErrors: [{ message: "Invalid data." }] };
    }
    if (!productId || !field || entries.length === 0) {
      return { intent, ok: false, userErrors: [{ message: "Nothing to update." }] };
    }
    const { userErrors } = await bulkUpdateVariants(admin, {
      productId,
      field,
      entries,
    });
    return { intent, ok: userErrors.length === 0, userErrors };
  }

  if (intent === "bulkDelete") {
    const variantIds = JSON.parse(String(formData.get("variantIds") || "[]"));
    if (!productId || variantIds.length === 0) {
      return { intent, ok: false, userErrors: [{ message: "No variants selected." }] };
    }
    const { userErrors } = await deleteVariants(admin, { productId, variantIds });
    return { intent, ok: userErrors.length === 0, userErrors };
  }

  if (intent === "bulkStock") {
    let quantitiesByVariantId;
    try {
      quantitiesByVariantId = JSON.parse(String(formData.get("quantities") || "{}"));
    } catch {
      return { intent, ok: false, userErrors: [{ message: "Invalid data." }] };
    }
    if (Object.keys(quantitiesByVariantId).length === 0) {
      return { intent, ok: false, userErrors: [{ message: "No variants selected." }] };
    }
    try {
      const { userErrors } = await setVariantQuantities(admin, {
        quantitiesByVariantId,
      });
      return { intent, ok: userErrors.length === 0, userErrors };
    } catch (error) {
      console.error("Bulk stock update failed", error);
      return { intent, ok: false, userErrors: [{ message: error.message || "Stock update failed." }] };
    }
  }

  if (intent === "bulkAddImage") {
    const variantIds = JSON.parse(String(formData.get("variantIds") || "[]"));
    const file = formData.get("file");
    if (!productId || variantIds.length === 0 || typeof file === "string" || !file) {
      return { intent, ok: false, error: "Missing image or selection." };
    }
    try {
      await addImageToVariants(admin, {
        productId,
        variantIds,
        filename: file.name || "variant-image",
        mimeType: file.type || "image/jpeg",
        fileSize: file.size,
        bytes: await file.arrayBuffer(),
      });
      return { intent, ok: true };
    } catch (error) {
      console.error("Bulk image add failed", error);
      return { intent, ok: false, error: "Image upload failed." };
    }
  }

  if (intent === "bulkRemoveImage") {
    let variantMedia;
    try {
      variantMedia = JSON.parse(String(formData.get("variants") || "[]"));
    } catch {
      return { intent, ok: false, error: "Invalid data." };
    }
    try {
      await removeImageFromVariants(admin, { productId, variants: variantMedia });
      return { intent, ok: true };
    } catch (error) {
      console.error("Bulk image remove failed", error);
      return { intent, ok: false, error: "Image removal failed." };
    }
  }

  if (intent === "bulkPublish") {
    const publicationIds = JSON.parse(String(formData.get("publicationIds") || "[]"));
    const publish = String(formData.get("publish") || "true") === "true";
    if (!productId || publicationIds.length === 0) {
      return { intent, ok: false, userErrors: [{ message: "No channels selected." }] };
    }
    const { userErrors } = await setProductPublishing(admin, {
      productId,
      publicationIds,
      publish,
    });
    return { intent, ok: userErrors.length === 0, userErrors };
  }

  // --- Browse-list bulk actions (a selection can span many products) ---
  // A group is { productId, variantIds: [ids] | "all" }; "all" is resolved here.
  const resolveGroupIds = async (group) =>
    group.variantIds === "all"
      ? await resolveProductVariantIds(admin, group.productId)
      : group.variantIds;

  if (intent === "listBulkField") {
    const field = String(formData.get("field") || "");
    let value;
    let groups;
    try {
      value = JSON.parse(String(formData.get("value") ?? "null"));
      groups = JSON.parse(String(formData.get("groups") || "[]"));
    } catch {
      return { intent, ok: false, userErrors: [{ message: "Invalid data." }] };
    }
    const userErrors = [];
    for (const group of groups) {
      const ids = await resolveGroupIds(group);
      if (ids.length === 0) continue;
      const entries = ids.map((id) => ({ id, value }));
      const res = await bulkUpdateVariants(admin, {
        productId: group.productId,
        field,
        entries,
      });
      userErrors.push(...res.userErrors);
    }
    return { intent, ok: userErrors.length === 0, userErrors };
  }

  if (intent === "listBulkStock") {
    const qty = Math.max(0, Math.trunc(Number(formData.get("value"))));
    let groups;
    try {
      groups = JSON.parse(String(formData.get("groups") || "[]"));
    } catch {
      return { intent, ok: false, userErrors: [{ message: "Invalid data." }] };
    }
    const userErrors = [];
    try {
      for (const group of groups) {
        const ids = await resolveGroupIds(group);
        if (ids.length === 0) continue;
        const quantitiesByVariantId = Object.fromEntries(ids.map((id) => [id, qty]));
        const res = await setVariantQuantities(admin, { quantitiesByVariantId });
        userErrors.push(...res.userErrors);
      }
    } catch (error) {
      console.error("List bulk stock failed", error);
      return { intent, ok: false, userErrors: [{ message: error.message || "Stock update failed." }] };
    }
    return { intent, ok: userErrors.length === 0, userErrors };
  }

  if (intent === "listBulkDelete") {
    let groups;
    try {
      groups = JSON.parse(String(formData.get("groups") || "[]"));
    } catch {
      return { intent, ok: false, userErrors: [{ message: "Invalid data." }] };
    }
    const userErrors = [];
    let skipped = 0;
    for (const group of groups) {
      // A whole-product selection would delete every variant, which Shopify
      // forbids (a product must keep at least one). Skip those.
      if (group.variantIds === "all") {
        skipped += 1;
        continue;
      }
      if (group.variantIds.length === 0) continue;
      const res = await deleteVariants(admin, {
        productId: group.productId,
        variantIds: group.variantIds,
      });
      userErrors.push(...res.userErrors);
    }
    if (skipped > 0) {
      userErrors.push({
        message: `Skipped ${skipped} fully-selected product(s) — a product must keep at least one variant.`,
      });
    }
    return { intent, ok: userErrors.length === 0, userErrors };
  }

  if (intent === "listBulkAddImage") {
    const file = formData.get("file");
    let groups;
    try {
      groups = JSON.parse(String(formData.get("groups") || "[]"));
    } catch {
      return { intent, ok: false, error: "Invalid data." };
    }
    if (typeof file === "string" || !file) {
      return { intent, ok: false, error: "Missing image." };
    }
    try {
      const bytes = await file.arrayBuffer();
      for (const group of groups) {
        const ids = await resolveGroupIds(group);
        if (ids.length === 0) continue;
        await addImageToVariants(admin, {
          productId: group.productId,
          variantIds: ids,
          filename: file.name || "variant-image",
          mimeType: file.type || "image/jpeg",
          fileSize: file.size,
          bytes,
        });
      }
      return { intent, ok: true };
    } catch (error) {
      console.error("List bulk add image failed", error);
      return { intent, ok: false, error: "Image upload failed." };
    }
  }

  if (intent === "listBulkRemoveImage") {
    let groups;
    try {
      groups = JSON.parse(String(formData.get("groups") || "[]"));
    } catch {
      return { intent, ok: false, error: "Invalid data." };
    }
    try {
      for (const group of groups) {
        const ids = await resolveGroupIds(group);
        if (ids.length === 0) continue;
        await removeVariantImagesByIds(admin, {
          productId: group.productId,
          variantIds: ids,
        });
      }
      return { intent, ok: true };
    } catch (error) {
      console.error("List bulk remove image failed", error);
      return { intent, ok: false, error: "Image removal failed." };
    }
  }

  if (intent === "listBulkPublish") {
    let productIds;
    let publicationIds;
    try {
      productIds = JSON.parse(String(formData.get("productIds") || "[]"));
      publicationIds = JSON.parse(String(formData.get("publicationIds") || "[]"));
    } catch {
      return { intent, ok: false, userErrors: [{ message: "Invalid data." }] };
    }
    const publish = String(formData.get("publish") || "true") === "true";
    if (productIds.length === 0 || publicationIds.length === 0) {
      return { intent, ok: false, userErrors: [{ message: "Nothing selected." }] };
    }
    const userErrors = [];
    for (const productId of productIds) {
      const res = await setProductPublishing(admin, {
        productId,
        publicationIds,
        publish,
      });
      userErrors.push(...res.userErrors);
    }
    return { intent, ok: userErrors.length === 0, userErrors };
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
      // Track inventory so stock quantities can be set, and carry the SKU on
      // the inventory item (its home in the current API).
      inventoryItem: {
        tracked: true,
        ...(variant.sku ? { sku: variant.sku } : {}),
      },
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

const WEIGHT_UNITS = ["GRAMS", "KILOGRAMS", "OUNCES", "POUNDS"];

// Bulk actions shown in the "…" menu, mirroring Shopify's native variant menu.
const BULK_ACTIONS = [
  { id: "price", label: "Edit prices" },
  { id: "sku", label: "Edit SKUs" },
  { id: "stock", label: "Edit stock" },
  { id: "barcode", label: "Edit barcodes" },
  { id: "weight", label: "Edit weight" },
  { id: "package", label: "Edit package" },
  { id: "country", label: "Edit country/region of origin" },
  { id: "addImage", label: "Add images" },
  { id: "removeImage", label: "Remove images" },
  { id: "publish", label: "Manage publishing" },
  { id: "continueSelling", label: "Continue selling when out of stock" },
  { id: "stopSelling", label: "Stop selling when out of stock" },
  { id: "delete", label: "Delete variants" },
];

const BULK_TITLES = Object.fromEntries(BULK_ACTIONS.map((a) => [a.id, a.label]));

/**
 * Modal for a single bulk action. Collects the action's inputs, then calls
 * onApply({ fields, encType }) with the FormData fields for the route intent.
 * Each variant in `selected` is already saved (has an id).
 */
function BulkModal({ action, selected, count: countProp, publications, onApply, onClose, busy, listMode }) {
  const [text, setText] = useState("");
  const [num, setNum] = useState("");
  const [priceMode, setPriceMode] = useState("set"); // set | amount | percent
  const [unit, setUnit] = useState("GRAMS");
  const [requiresShipping, setRequiresShipping] = useState(true);
  const [file, setFile] = useState(null);
  const [pubIds, setPubIds] = useState(() => new Set());

  const count = typeof countProp === "number" ? countProp : selected.length;
  const ids = selected.map((v) => v.id);

  const same = (field, value) =>
    ids.map((id) => ({ id, value }));

  const apply = () => {
    switch (action) {
      case "price": {
        const amount = Number(num);
        if (!Number.isFinite(amount)) return;
        const entries = selected.map((v) => {
          const current = Number(v.price) || 0;
          let next = amount;
          if (priceMode === "amount") next = current + amount;
          else if (priceMode === "percent") next = current * (1 + amount / 100);
          return { id: v.id, value: Math.max(0, next).toFixed(2) };
        });
        onApply({ fields: { intent: "bulkUpdate", field: "price", entries: JSON.stringify(entries) } });
        return;
      }
      case "sku":
        onApply({ fields: { intent: "bulkUpdate", field: "sku", entries: JSON.stringify(same("sku", text)) } });
        return;
      case "barcode":
        onApply({ fields: { intent: "bulkUpdate", field: "barcode", entries: JSON.stringify(same("barcode", text)) } });
        return;
      case "stock": {
        const qty = Math.max(0, Math.trunc(Number(num)));
        if (!Number.isFinite(qty)) return;
        const quantities = Object.fromEntries(ids.map((id) => [id, qty]));
        onApply({ fields: { intent: "bulkStock", quantities: JSON.stringify(quantities) } });
        return;
      }
      case "weight": {
        const value = Number(num);
        if (!Number.isFinite(value)) return;
        onApply({ fields: { intent: "bulkUpdate", field: "weight", entries: JSON.stringify(same("weight", { value, unit })) } });
        return;
      }
      case "package": {
        const value = { requiresShipping };
        const w = Number(num);
        if (Number.isFinite(w) && num !== "") value.weight = { value: w, unit };
        onApply({ fields: { intent: "bulkUpdate", field: "package", entries: JSON.stringify(same("package", value)) } });
        return;
      }
      case "country":
        onApply({ fields: { intent: "bulkUpdate", field: "country", entries: JSON.stringify(same("country", text)) } });
        return;
      case "continueSelling":
        onApply({ fields: { intent: "bulkUpdate", field: "inventoryPolicy", entries: JSON.stringify(same("inventoryPolicy", "CONTINUE")) } });
        return;
      case "stopSelling":
        onApply({ fields: { intent: "bulkUpdate", field: "inventoryPolicy", entries: JSON.stringify(same("inventoryPolicy", "DENY")) } });
        return;
      case "delete":
        onApply({ fields: { intent: "bulkDelete", variantIds: JSON.stringify(ids) } });
        return;
      case "removeImage":
        onApply({
          fields: {
            intent: "bulkRemoveImage",
            variants: JSON.stringify(
              selected.map((v) => ({ variantId: v.id, mediaId: v.mediaId })),
            ),
          },
        });
        return;
      case "addImage": {
        if (!file) return;
        onApply({
          fields: { intent: "bulkAddImage", variantIds: JSON.stringify(ids), file },
          encType: "multipart/form-data",
        });
        return;
      }
      case "publish": {
        if (pubIds.size === 0) return;
        onApply({
          fields: {
            intent: "bulkPublish",
            publicationIds: JSON.stringify([...pubIds]),
            publish: "true",
          },
        });
        return;
      }
      default:
        return;
    }
  };

  const applyUnpublish = () => {
    onApply({
      fields: {
        intent: "bulkPublish",
        publicationIds: JSON.stringify([...pubIds]),
        publish: "false",
      },
    });
  };

  // In list mode a selection spans many products, so the modal returns the raw
  // action + uniform value; the list view packages it with the selection groups.
  const listApply = (publishFlag = true) => {
    switch (action) {
      case "price": {
        const v = Number(num);
        if (!Number.isFinite(v)) return;
        onApply({ list: { action: "price", value: Math.max(0, v).toFixed(2) } });
        return;
      }
      case "sku":
        onApply({ list: { action: "sku", value: text } });
        return;
      case "barcode":
        onApply({ list: { action: "barcode", value: text } });
        return;
      case "stock": {
        const q = Math.max(0, Math.trunc(Number(num)));
        if (!Number.isFinite(q)) return;
        onApply({ list: { action: "stock", value: q } });
        return;
      }
      case "weight": {
        const v = Number(num);
        if (!Number.isFinite(v)) return;
        onApply({ list: { action: "weight", value: { value: v, unit } } });
        return;
      }
      case "package": {
        const value = { requiresShipping };
        const w = Number(num);
        if (Number.isFinite(w) && num !== "") value.weight = { value: w, unit };
        onApply({ list: { action: "package", value } });
        return;
      }
      case "country":
        onApply({ list: { action: "country", value: text } });
        return;
      case "continueSelling":
        onApply({ list: { action: "inventoryPolicy", value: "CONTINUE" } });
        return;
      case "stopSelling":
        onApply({ list: { action: "inventoryPolicy", value: "DENY" } });
        return;
      case "delete":
        onApply({ list: { action: "delete" } });
        return;
      case "removeImage":
        onApply({ list: { action: "removeImage" } });
        return;
      case "addImage":
        if (!file) return;
        onApply({ list: { action: "addImage", file } });
        return;
      case "publish":
        if (pubIds.size === 0) return;
        onApply({ list: { action: "publish", publicationIds: [...pubIds], publish: publishFlag } });
        return;
      default:
        return;
    }
  };

  const togglePub = (id) =>
    setPubIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const numberBody = (label, placeholder) => (
    <s-text-field
      label={label}
      inputMode="numeric"
      placeholder={placeholder}
      value={num}
      onChange={(e) => setNum(e.target.value)}
    />
  );

  const textBody = (label, placeholder) => (
    <s-text-field
      label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );

  const weightUnitSelect = () => (
    <s-select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
      {WEIGHT_UNITS.map((u) => (
        <s-option key={u} value={u}>
          {u.toLowerCase()}
        </s-option>
      ))}
    </s-select>
  );

  let body = null;
  if (action === "price") {
    body = listMode ? (
      numberBody("Set price to", "0.00")
    ) : (
      <s-stack direction="block" gap="base">
        <s-select label="How" value={priceMode} onChange={(e) => setPriceMode(e.target.value)}>
          <s-option value="set">Set price to</s-option>
          <s-option value="amount">Adjust by amount</s-option>
          <s-option value="percent">Adjust by percent</s-option>
        </s-select>
        {numberBody(priceMode === "percent" ? "Percent" : "Amount", "0.00")}
      </s-stack>
    );
  } else if (action === "sku") body = textBody("SKU", "New SKU for all selected");
  else if (action === "barcode") body = textBody("Barcode", "New barcode");
  else if (action === "stock") body = numberBody("Available quantity", "0");
  else if (action === "weight") {
    body = (
      <s-stack direction="inline" gap="base" alignItems="end">
        {numberBody("Weight", "0")}
        {weightUnitSelect()}
      </s-stack>
    );
  } else if (action === "package") {
    body = (
      <s-stack direction="block" gap="base">
        <s-checkbox
          label="This is a physical product (requires shipping)"
          checked={requiresShipping}
          onChange={(e) => setRequiresShipping(e.target.checked)}
        />
        {requiresShipping && (
          <s-stack direction="inline" gap="base" alignItems="end">
            {numberBody("Weight (optional)", "0")}
            {weightUnitSelect()}
          </s-stack>
        )}
      </s-stack>
    );
  } else if (action === "country") {
    body = (
      <s-select label="Country/region of origin" value={text} onChange={(e) => setText(e.target.value)}>
        <s-option value="">— None —</s-option>
        {COUNTRIES.map((c) => (
          <s-option key={c.code} value={c.code}>
            {c.name}
          </s-option>
        ))}
      </s-select>
    );
  } else if (action === "addImage") {
    body = (
      <s-stack direction="block" gap="base">
        <s-paragraph>Upload one image and apply it to all {count} selected variants.</s-paragraph>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </s-stack>
    );
  } else if (action === "removeImage") {
    body = <s-paragraph>Remove the image from {count} selected variants? They revert to the product default.</s-paragraph>;
  } else if (action === "delete") {
    body = <s-paragraph>Delete {count} selected variants? This can&apos;t be undone.</s-paragraph>;
  } else if (action === "continueSelling") {
    body = <s-paragraph>Let customers buy {count} selected variants when they&apos;re out of stock?</s-paragraph>;
  } else if (action === "stopSelling") {
    body = <s-paragraph>Stop selling {count} selected variants when they&apos;re out of stock?</s-paragraph>;
  } else if (action === "publish") {
    body = (
      <s-stack direction="block" gap="base">
        <s-paragraph>Choose sales channels, then Publish or Unpublish the product.</s-paragraph>
        <s-stack direction="block" gap="small">
          {publications.length === 0 ? (
            <s-text color="subdued">No sales channels found.</s-text>
          ) : (
            publications.map((p) => (
              <s-checkbox
                key={p.id}
                label={p.name}
                checked={pubIds.has(p.id)}
                onChange={() => togglePub(p.id)}
              />
            ))
          )}
        </s-stack>
      </s-stack>
    );
  }

  const destructive = action === "delete";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 40,
        padding: "16px",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          padding: 0,
          background: "rgba(0,0,0,0.35)",
          cursor: "default",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          background: "#fff",
          borderRadius: "12px",
          padding: "20px",
          width: "min(460px, 100%)",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
      >
        <s-stack direction="block" gap="base">
          <s-heading>{BULK_TITLES[action]}</s-heading>
          <s-text color="subdued">{count} selected</s-text>
          {body}
          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button variant="tertiary" onClick={onClose} disabled={busy}>
              Cancel
            </s-button>
            {action === "publish" && (
              <s-button
                variant="secondary"
                onClick={listMode ? () => listApply(false) : applyUnpublish}
                disabled={busy || pubIds.size === 0}
              >
                Unpublish
              </s-button>
            )}
            <s-button
              variant="primary"
              tone={destructive ? "critical" : undefined}
              onClick={listMode ? () => listApply(true) : apply}
              {...(busy ? { loading: true } : {})}
            >
              {action === "delete" ? "Delete" : action === "publish" ? "Publish" : "Apply"}
            </s-button>
          </s-stack>
        </s-stack>
      </div>
    </div>
  );
}

export default function Variants() {
  const { product, productList, publications = [] } = useLoaderData();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const statusFetcher = useFetcher();
  const imageFetcher = useFetcher();
  const stockFetcher = useFetcher();
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
  // Bulk editing: selected saved-variant ids + the open action modal.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkAction, setBulkAction] = useState(null); // e.g. "price", "sku", ...
  const bulkFetcher = useFetcher();
  // Browse-list selection: whole products + individual variants across products.
  const [selProducts, setSelProducts] = useState(() => new Set());
  const [selVariants, setSelVariants] = useState(() => new Set());
  const [listBulkAction, setListBulkAction] = useState(null);
  const listBulkFetcher = useFetcher();

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
        quantity: node.inventoryQuantity ?? 0,
        imageUrl: node.media?.nodes?.[0]?.image?.url ?? null,
        mediaId: node.media?.nodes?.[0]?.id ?? null,
        key: node.id,
      })),
    );
    setSelectedIds(new Set());
    setWarning("");
  }, [product]);

  // Push the inline per-variant quantities to Shopify inventory, keyed by option
  // combo so it also covers brand-new variants. Reads current on-screen values.
  const syncInlineStock = () => {
    const quantitiesByKey = {};
    for (const v of variants) {
      const qty = Math.trunc(Number(v.quantity));
      if (Number.isFinite(qty)) quantitiesByKey[v.options.join("||")] = Math.max(0, qty);
    }
    if (Object.keys(quantitiesByKey).length === 0) return;
    const formData = new FormData();
    formData.append("productId", product.id);
    formData.append("intent", "syncStock");
    formData.append("quantities", JSON.stringify(quantitiesByKey));
    stockFetcher.submit(formData, { method: "POST" });
  };

  // Handle the save fetcher result (sync success or start of async polling).
  useEffect(() => {
    if (fetcher.data?.mode === "async" && fetcher.data.operationId) {
      setOperationId(fetcher.data.operationId);
    }
    if (fetcher.data?.mode === "sync" && fetcher.data.ok) {
      setSaveSuccess(true);
      shopify.toast.show("Variants saved");
      syncInlineStock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      syncInlineStock();
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
          : { id: null, options: combo, price: "", sku: "", quantity: 0, key };
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

  // --- Bulk selection & actions (saved variants only) ---
  const savedVariants = variants.filter((v) => v.id);
  const allSelected =
    savedVariants.length > 0 && selectedIds.size === savedVariants.length;
  const selected = variants.filter((v) => selectedIds.has(v.id));

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === savedVariants.length
        ? new Set()
        : new Set(savedVariants.map((v) => v.id)),
    );
  };

  // Submit a bulk action; `fields` are appended to a FormData with the productId.
  const submitBulk = (fields, encType) => {
    const formData = new FormData();
    formData.append("productId", product.id);
    for (const [k, v] of Object.entries(fields)) formData.append(k, v);
    bulkFetcher.submit(formData, {
      method: "POST",
      ...(encType ? { encType } : {}),
    });
  };

  // Handle a browse-list bulk result: toast, refresh, and clear on success.
  useEffect(() => {
    const data = listBulkFetcher.data;
    if (!data || !String(data.intent || "").startsWith("listBulk")) return;
    shopify.toast.show(
      data.ok
        ? "Products updated"
        : data.error ||
            data.userErrors?.map((e) => e.message).join("; ") ||
            "Bulk action failed",
    );
    setListBulkAction(null);
    revalidator.revalidate();
    if (data.ok) {
      setSelProducts(new Set());
      setSelVariants(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listBulkFetcher.data]);

  // Handle a bulk result: toast, refresh, close modal, clear selection.
  useEffect(() => {
    const data = bulkFetcher.data;
    if (!data || !String(data.intent || "").startsWith("bulk")) return;
    if (data.ok) {
      shopify.toast.show("Variants updated");
      setBulkAction(null);
      setSelectedIds(new Set());
      revalidator.revalidate();
    } else {
      shopify.toast.show(
        data.error ||
          data.userErrors?.map((e) => e.message).join("; ") ||
          "Bulk action failed",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkFetcher.data]);

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
            {variant.id && (
              <s-checkbox
                checked={selectedIds.has(variant.id)}
                onChange={() => toggleSelect(variant.id)}
                accessibilityLabel={`Select ${variant.options.join(" / ")}`}
              />
            )}
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
              Quantity
            </span>
            <s-text-field
              label="Quantity"
              labelAccessibilityVisibility="exclusive"
              inputMode="numeric"
              value={String(variant.quantity ?? 0)}
              onChange={(e) => updateVariant(vi, "quantity", e.target.value)}
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

    const variantToProduct = new Map();
    for (const it of items) {
      for (const v of it.variants.nodes) variantToProduct.set(v.id, it.id);
    }

    const isVariantSel = (v, productId) =>
      selProducts.has(productId) || selVariants.has(v.id);

    const toggleProduct = (id) => {
      setSelProducts((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      // Selecting the whole product supersedes any individual variant picks.
      setSelVariants((prev) => {
        const next = new Set(prev);
        for (const [vid, pid] of variantToProduct) {
          if (pid === id) next.delete(vid);
        }
        return next;
      });
    };

    const toggleVariantSel = (vid) => {
      setSelVariants((prev) => {
        const next = new Set(prev);
        if (next.has(vid)) next.delete(vid);
        else next.add(vid);
        return next;
      });
    };

    const allProductsSelected =
      items.length > 0 && items.every((it) => selProducts.has(it.id));
    const toggleAllProducts = () => {
      if (allProductsSelected) {
        setSelProducts(new Set());
      } else {
        setSelProducts(new Set(items.map((it) => it.id)));
        setSelVariants(new Set());
      }
    };

    const selCount = selProducts.size + selVariants.size;

    // Turn the selection into [{ productId, variantIds: [ids] | "all" }].
    const buildGroups = () => {
      const groups = [];
      for (const pid of selProducts) {
        groups.push({ productId: pid, variantIds: "all" });
      }
      const byProduct = new Map();
      for (const vid of selVariants) {
        const pid = variantToProduct.get(vid);
        if (!pid || selProducts.has(pid)) continue;
        if (!byProduct.has(pid)) byProduct.set(pid, []);
        byProduct.get(pid).push(vid);
      }
      for (const [pid, vids] of byProduct) {
        groups.push({ productId: pid, variantIds: vids });
      }
      return groups;
    };

    const submitListBulk = (fields, encType) => {
      const formData = new FormData();
      for (const [k, v] of Object.entries(fields)) formData.append(k, v);
      listBulkFetcher.submit(formData, {
        method: "POST",
        ...(encType ? { encType } : {}),
      });
    };

    // Package the modal's raw { action, value } with the selection groups.
    const onListApply = ({ list }) => {
      const groups = buildGroups();
      if (groups.length === 0) return;
      const g = JSON.stringify(groups);
      switch (list.action) {
        case "price":
        case "sku":
        case "barcode":
        case "weight":
        case "package":
        case "country":
        case "inventoryPolicy":
          submitListBulk({
            intent: "listBulkField",
            field: list.action,
            value: JSON.stringify(list.value),
            groups: g,
          });
          return;
        case "stock":
          submitListBulk({ intent: "listBulkStock", value: String(list.value), groups: g });
          return;
        case "delete":
          submitListBulk({ intent: "listBulkDelete", groups: g });
          return;
        case "removeImage":
          submitListBulk({ intent: "listBulkRemoveImage", groups: g });
          return;
        case "addImage":
          submitListBulk(
            { intent: "listBulkAddImage", groups: g, file: list.file },
            "multipart/form-data",
          );
          return;
        case "publish": {
          const productIds = [
            ...new Set([
              ...selProducts,
              ...[...selVariants]
                .map((vid) => variantToProduct.get(vid))
                .filter(Boolean),
            ]),
          ];
          submitListBulk({
            intent: "listBulkPublish",
            productIds: JSON.stringify(productIds),
            publicationIds: JSON.stringify(list.publicationIds),
            publish: String(list.publish),
          });
          return;
        }
        default:
          return;
      }
    };

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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  flexWrap: "wrap",
                  padding: "10px 12px",
                  border: "1px solid #e3e3e3",
                  borderRadius: "10px",
                  background: selCount ? "#f1f8f5" : "#fff",
                  position: "sticky",
                  top: "8px",
                  zIndex: 5,
                }}
              >
                <s-checkbox
                  checked={allProductsSelected}
                  onChange={toggleAllProducts}
                  label={
                    selCount > 0 ? `${selCount} selected` : "Select all products"
                  }
                />
                {selCount > 0 && (
                  <details style={{ position: "relative", marginInlineStart: "auto" }}>
                    <summary
                      style={{
                        listStyle: "none",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontWeight: 600,
                        padding: "6px 12px",
                        borderRadius: "8px",
                        border: "1px solid #c9cccf",
                        background: "#fff",
                      }}
                    >
                      Edit ▾
                    </summary>
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "110%",
                        background: "#fff",
                        border: "1px solid #e3e3e3",
                        borderRadius: "10px",
                        boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
                        minWidth: "260px",
                        zIndex: 20,
                        overflow: "hidden",
                        padding: "4px 0",
                      }}
                    >
                      {BULK_ACTIONS.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={(e) => {
                            setListBulkAction(a.id);
                            e.currentTarget.closest("details").open = false;
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 14px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: "13px",
                            color: a.id === "delete" ? "#DE3618" : "inherit",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "#f6f6f7";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>

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
                          <s-checkbox
                            checked={selProducts.has(item.id)}
                            onChange={() => toggleProduct(item.id)}
                            accessibilityLabel={`Select ${item.title}`}
                          />
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
                              {item.hasOnlyDefaultVariant ? "" : optionNames || "No options"}
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
                                <s-table-header></s-table-header>
                                <s-table-header>Variant</s-table-header>
                                <s-table-header>Price</s-table-header>
                                <s-table-header>SKU</s-table-header>
                              </s-table-header-row>
                              <s-table-body>
                                {shown.map((variant) => (
                                  <s-table-row key={variant.id}>
                                    <s-table-cell>
                                      <s-checkbox
                                        checked={isVariantSel(variant, item.id)}
                                        disabled={selProducts.has(item.id)}
                                        onChange={() => toggleVariantSel(variant.id)}
                                        accessibilityLabel={`Select ${variant.title}`}
                                      />
                                    </s-table-cell>
                                    <s-table-cell>
                                      {item.hasOnlyDefaultVariant ? (
                                        <s-text color="subdued">No variants</s-text>
                                      ) : (
                                        variant.title
                                      )}
                                    </s-table-cell>
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
            Every product in your store is listed here. Select products or
            individual variants and choose{" "}
            <s-text type="strong">Edit</s-text> to change stock, prices,
            images, and more across many products at once — or{" "}
            <s-text type="strong">Edit</s-text> a single product to manage its
            variants in detail.
          </s-paragraph>
          <s-paragraph>
            <s-text color="subdued">
              Per-variant selection covers the variants shown; select the whole
              product to apply an action to all of its variants.
            </s-text>
          </s-paragraph>
        </s-section>

        {listBulkAction && (
          <BulkModal
            action={listBulkAction}
            listMode
            count={selCount}
            selected={[]}
            publications={publications}
            busy={listBulkFetcher.state !== "idle"}
            onClose={() => setListBulkAction(null)}
            onApply={onListApply}
          />
        )}
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

            {savedVariants.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  flexWrap: "wrap",
                  padding: "10px 12px",
                  border: "1px solid #e3e3e3",
                  borderRadius: "10px",
                  background: selected.length ? "#f1f8f5" : "#fff",
                  position: "sticky",
                  top: "8px",
                  zIndex: 5,
                }}
              >
                <s-checkbox
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  label={
                    selected.length > 0
                      ? `${selected.length} selected`
                      : "Select all"
                  }
                />
                {selected.length > 0 && (
                  <details style={{ position: "relative", marginInlineStart: "auto" }}>
                    <summary
                      style={{
                        listStyle: "none",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontWeight: 600,
                        padding: "6px 12px",
                        borderRadius: "8px",
                        border: "1px solid #c9cccf",
                        background: "#fff",
                      }}
                    >
                      Edit ▾
                    </summary>
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "110%",
                        background: "#fff",
                        border: "1px solid #e3e3e3",
                        borderRadius: "10px",
                        boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
                        minWidth: "260px",
                        zIndex: 20,
                        overflow: "hidden",
                        padding: "4px 0",
                      }}
                    >
                      {BULK_ACTIONS.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={(e) => {
                            setBulkAction(a.id);
                            e.currentTarget.closest("details").open = false;
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 14px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: "13px",
                            color: a.id === "delete" ? "#DE3618" : "inherit",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "#f6f6f7";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>
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
          generate every combination as a variant. Edit price, SKU, and quantity
          inline, or select variants and use <s-text type="strong">Edit</s-text>{" "}
          to change prices, stock, images, and more — up to {MAX_VARIANTS}{" "}
          variants per product (Shopify&apos;s maximum).
        </s-paragraph>
      </s-section>

      {bulkAction && (
        <BulkModal
          action={bulkAction}
          selected={selected}
          publications={publications}
          busy={bulkFetcher.state !== "idle"}
          onClose={() => setBulkAction(null)}
          onApply={({ fields, encType }) => submitBulk(fields, encType)}
        />
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
