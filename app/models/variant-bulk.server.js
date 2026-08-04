/**
 * Bulk variant actions for the Products editor, mirroring Shopify's native
 * variant bulk-edit menu. Most field edits go through productVariantsBulkUpdate;
 * deletes through productVariantsBulkDelete; images reuse variant-media.server;
 * stock lives in inventory.server; publishing is product-level.
 */

import {
  uploadProductImage,
  assignVariantImage,
  clearVariantImage,
} from "./variant-media.server";

const PRODUCT_VARIANT_IDS_QUERY = `#graphql
  query ProductVariantIds($id: ID!, $cursor: String) {
    product(id: $id) {
      variants(first: 250, after: $cursor) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

const VARIANT_MEDIA_BY_IDS = `#graphql
  query VariantMedia($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        media(first: 1) { nodes { id } }
      }
    }
  }`;

const VARIANTS_BULK_UPDATE = `#graphql
  mutation BulkUpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }`;

const VARIANTS_BULK_DELETE = `#graphql
  mutation BulkDeleteVariants($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      product { id }
      userErrors { field message }
    }
  }`;

const PUBLICATIONS_QUERY = `#graphql
  query Publications {
    publications(first: 50) {
      nodes { id name }
    }
  }`;

const PUBLISHABLE_PUBLISH = `#graphql
  mutation Publish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }`;

const PUBLISHABLE_UNPUBLISH = `#graphql
  mutation Unpublish($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }`;

/**
 * Maps a bulk-edit field + value to the ProductVariantsBulkInput shape for one
 * variant. `value` is per-variant, so price adjustments (computed client-side)
 * and uniform sets both flow through here.
 */
function buildVariantInput(id, field, value) {
  switch (field) {
    case "price":
      return { id, price: String(value) };
    case "sku":
      return { id, inventoryItem: { sku: value ?? "" } };
    case "barcode":
      return { id, barcode: value ?? "" };
    case "weight":
      // value: { value: number, unit: WeightUnit }
      return { id, inventoryItem: { measurement: { weight: value } } };
    case "country":
      // value: ISO CountryCode or null to clear
      return { id, inventoryItem: { countryCodeOfOrigin: value || null } };
    case "package":
      // value: { requiresShipping: boolean, weight?: { value, unit } }
      return {
        id,
        inventoryItem: {
          requiresShipping: value.requiresShipping,
          ...(value.weight ? { measurement: { weight: value.weight } } : {}),
        },
      };
    case "inventoryPolicy":
      // value: "CONTINUE" | "DENY"
      return { id, inventoryPolicy: value };
    default:
      throw new Error(`Unknown bulk field: ${field}`);
  }
}

/**
 * Applies a field edit to many variants. `entries` is [{ id, value }] so each
 * variant can carry its own value (price adjust) or share one (uniform set).
 */
export async function bulkUpdateVariants(admin, { productId, field, entries }) {
  const variants = entries.map((e) => buildVariantInput(e.id, field, e.value));
  const response = await admin.graphql(VARIANTS_BULK_UPDATE, {
    variables: { productId, variants },
  });
  const json = await response.json();
  return { userErrors: json.data?.productVariantsBulkUpdate?.userErrors ?? [] };
}

export async function deleteVariants(admin, { productId, variantIds }) {
  const response = await admin.graphql(VARIANTS_BULK_DELETE, {
    variables: { productId, variantsIds: variantIds },
  });
  const json = await response.json();
  return { userErrors: json.data?.productVariantsBulkDelete?.userErrors ?? [] };
}

/** Uploads one image and assigns it to every selected variant. */
export async function addImageToVariants(
  admin,
  { productId, variantIds, filename, mimeType, fileSize, bytes },
) {
  const { mediaId } = await uploadProductImage(admin, {
    productId,
    filename,
    mimeType,
    fileSize,
    bytes,
  });
  for (const variantId of variantIds) {
    await assignVariantImage(admin, { productId, variantId, mediaId });
  }
  return { mediaId };
}

/** Detaches the current image from each selected variant. */
export async function removeImageFromVariants(admin, { productId, variants }) {
  for (const { variantId, mediaId } of variants) {
    if (!mediaId) continue;
    await clearVariantImage(admin, { productId, variantId, mediaId });
  }
}

/**
 * All variant ids for a product, paginated. Used to expand a whole-product
 * selection in the browse list into concrete variant ids.
 */
export async function resolveProductVariantIds(admin, productId) {
  const ids = [];
  let cursor = null;
  do {
    const response = await admin.graphql(PRODUCT_VARIANT_IDS_QUERY, {
      variables: { id: productId, cursor },
    });
    const json = await response.json();
    const conn = json.data?.product?.variants;
    if (!conn) break;
    for (const node of conn.nodes) ids.push(node.id);
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return ids;
}

/**
 * Detaches the current image from each given variant. Looks up each variant's
 * media id first (browse-list rows don't carry it), then reuses clearVariantImage.
 */
export async function removeVariantImagesByIds(admin, { productId, variantIds }) {
  if (variantIds.length === 0) return;
  const response = await admin.graphql(VARIANT_MEDIA_BY_IDS, {
    variables: { ids: variantIds },
  });
  const json = await response.json();
  for (const node of json.data?.nodes ?? []) {
    const mediaId = node?.media?.nodes?.[0]?.id;
    if (mediaId) {
      await clearVariantImage(admin, { productId, variantId: node.id, mediaId });
    }
  }
}

export async function listPublications(admin) {
  const response = await admin.graphql(PUBLICATIONS_QUERY);
  const json = await response.json();
  return json.data?.publications?.nodes ?? [];
}

/**
 * Publishes or unpublishes the product to the given sales channels.
 * Publishing is product-level in Shopify, so the selected variants only
 * identify the product.
 */
export async function setProductPublishing(
  admin,
  { productId, publicationIds, publish },
) {
  const input = publicationIds.map((publicationId) => ({ publicationId }));
  const response = await admin.graphql(
    publish ? PUBLISHABLE_PUBLISH : PUBLISHABLE_UNPUBLISH,
    { variables: { id: productId, input } },
  );
  const json = await response.json();
  const payload = publish
    ? json.data?.publishablePublish
    : json.data?.publishableUnpublish;
  return { userErrors: payload?.userErrors ?? [] };
}
