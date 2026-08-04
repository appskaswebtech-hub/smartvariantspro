/**
 * Inventory quantity sync for variants. Shopify requires an inventory item to
 * be tracked (set via productSet inventoryItem.tracked) and stocked at a
 * location before a quantity can be set:
 *   - not yet stocked at the location -> inventoryActivate (activates + sets)
 *   - already stocked                 -> inventorySetQuantities (updates)
 * Needs the write_inventory + read_locations scopes.
 *
 * Two entry points:
 *   setVariantQuantities        - by variant id (bulk "Edit stock").
 *   setVariantQuantitiesByOptions - by option-value combo (inline quantity on
 *     Save, which must work for brand-new variants that only get ids on save).
 */

const PRIMARY_LOCATION_QUERY = `#graphql
  query PrimaryLocation {
    locations(first: 1, query: "status:active") {
      nodes { id }
    }
  }`;

const VARIANT_INVENTORY_BY_IDS = `#graphql
  query VariantInventory($ids: [ID!]!, $locationId: ID!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        inventoryItem {
          id
          inventoryLevel(locationId: $locationId) { id }
        }
      }
    }
  }`;

const PRODUCT_VARIANTS_INVENTORY = `#graphql
  query ProductVariantsInventory($id: ID!, $cursor: String, $locationId: ID!) {
    product(id: $id) {
      options { name position }
      variants(first: 250, after: $cursor) {
        nodes {
          id
          selectedOptions { name value }
          inventoryItem {
            id
            inventoryLevel(locationId: $locationId) { id }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

const INVENTORY_ACTIVATE = `#graphql
  mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!, $available: Int!) {
    inventoryActivate(
      inventoryItemId: $inventoryItemId
      locationId: $locationId
      available: $available
    ) {
      inventoryLevel { id }
      userErrors { field message }
    }
  }`;

const INVENTORY_SET_QUANTITIES = `#graphql
  mutation SetInventory($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { field message }
    }
  }`;

/** First active location id, used as the stock location for the store. */
export async function getPrimaryLocationId(admin) {
  const response = await admin.graphql(PRIMARY_LOCATION_QUERY);
  const json = await response.json();
  const id = json.data?.locations?.nodes?.[0]?.id;
  if (!id) throw new Error("No active location found for this shop.");
  return id;
}

/**
 * Applies quantities to a list of resolved items:
 *   { inventoryItemId, hasLevel, quantity }
 * Activating (not stocked here) sets the quantity in one call; already-stocked
 * items are batched into a single inventorySetQuantities.
 */
async function applyQuantities(admin, locationId, items) {
  const errors = [];
  const toSet = [];

  for (const { inventoryItemId, hasLevel, quantity } of items) {
    if (hasLevel) {
      toSet.push({ inventoryItemId, locationId, quantity });
    } else {
      const res = await admin.graphql(INVENTORY_ACTIVATE, {
        variables: { inventoryItemId, locationId, available: quantity },
      });
      const json = await res.json();
      errors.push(...(json.data?.inventoryActivate?.userErrors ?? []));
    }
  }

  if (toSet.length > 0) {
    const res = await admin.graphql(INVENTORY_SET_QUANTITIES, {
      variables: {
        input: {
          name: "available",
          reason: "correction",
          ignoreCompareQuantity: true,
          quantities: toSet,
        },
      },
    });
    const json = await res.json();
    errors.push(...(json.data?.inventorySetQuantities?.userErrors ?? []));
  }

  return { userErrors: errors };
}

/** Sets available quantity for the given variant gids (bulk "Edit stock"). */
export async function setVariantQuantities(admin, { quantitiesByVariantId }) {
  const ids = Object.keys(quantitiesByVariantId);
  if (ids.length === 0) return { userErrors: [] };

  const locationId = await getPrimaryLocationId(admin);
  const res = await admin.graphql(VARIANT_INVENTORY_BY_IDS, {
    variables: { ids, locationId },
  });
  const json = await res.json();

  const items = (json.data?.nodes ?? [])
    .filter((v) => v?.inventoryItem?.id && quantitiesByVariantId[v.id] != null)
    .map((v) => ({
      inventoryItemId: v.inventoryItem.id,
      hasLevel: Boolean(v.inventoryItem.inventoryLevel),
      quantity: quantitiesByVariantId[v.id],
    }));

  return applyQuantities(admin, locationId, items);
}

/**
 * Sets available quantity keyed by option-value combo (values joined with "||"
 * in product-option order). Used on Save so a quantity typed on a brand-new
 * variant is applied even though its id only exists after the productSet.
 */
export async function setVariantQuantitiesByOptions(
  admin,
  { productId, quantitiesByKey },
) {
  if (Object.keys(quantitiesByKey).length === 0) return { userErrors: [] };

  const locationId = await getPrimaryLocationId(admin);

  const items = [];
  let cursor = null;
  let order = null; // option name -> position (0-based), set on first page
  do {
    const res = await admin.graphql(PRODUCT_VARIANTS_INVENTORY, {
      variables: { id: productId, cursor, locationId },
    });
    const json = await res.json();
    const product = json.data?.product;
    if (!product) break;

    if (!order) {
      order = new Map(
        [...product.options]
          .sort((a, b) => a.position - b.position)
          .map((o, i) => [o.name, i]),
      );
    }

    for (const v of product.variants.nodes) {
      if (!v.inventoryItem?.id) continue;
      const values = [];
      for (const so of v.selectedOptions) {
        const idx = order.get(so.name);
        if (idx != null) values[idx] = so.value;
      }
      const key = values.join("||");
      const quantity = quantitiesByKey[key];
      if (quantity == null) continue;
      items.push({
        inventoryItemId: v.inventoryItem.id,
        hasLevel: Boolean(v.inventoryItem.inventoryLevel),
        quantity,
      });
    }

    cursor = product.variants.pageInfo.hasNextPage
      ? product.variants.pageInfo.endCursor
      : null;
  } while (cursor);

  return applyQuantities(admin, locationId, items);
}
