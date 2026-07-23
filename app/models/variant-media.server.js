/**
 * Per-variant images, using Shopify's native variant-image system:
 *   PC file -> stagedUploadsCreate -> upload bytes -> productCreateMedia (adds
 *   a MediaImage to the product) -> productVariantsBulkUpdate { id, mediaId }
 *   (sets the variant's image). Detach reverts a variant to the product default.
 *
 * Uploading the bytes runs server-side (Node fetch), so there's no browser CORS
 * to the staged target. All of this is covered by the app's write_products scope.
 */

const STAGED_UPLOADS_CREATE = `#graphql
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }`;

const PRODUCT_CREATE_MEDIA = `#graphql
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
        ... on MediaImage { image { url } }
      }
      mediaUserErrors { field message }
    }
  }`;

const VARIANTS_BULK_UPDATE = `#graphql
  mutation AssignVariantMedia($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        media(first: 1) {
          nodes { id ... on MediaImage { image { url } } }
        }
      }
      userErrors { field message }
    }
  }`;

const VARIANT_DETACH_MEDIA = `#graphql
  mutation DetachVariantMedia($productId: ID!, $variantMedia: [ProductVariantDetachMediaInput!]!) {
    productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) {
      product { id }
      userErrors { field message }
    }
  }`;

function throwOnErrors(errors, label) {
  if (errors && errors.length > 0) {
    throw new Error(`${label}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

/**
 * Uploads image bytes as a new product media image. Returns the created
 * MediaImage id (which may still be processing — assignment works regardless)
 * and its preview url when already available.
 */
export async function uploadProductImage(
  admin,
  { productId, filename, mimeType, fileSize, bytes },
) {
  // 1. Reserve a staged upload target.
  const stagedResponse = await admin.graphql(STAGED_UPLOADS_CREATE, {
    variables: {
      input: [
        {
          filename,
          mimeType,
          resource: "IMAGE",
          httpMethod: "POST",
          fileSize: String(fileSize),
        },
      ],
    },
  });
  const stagedJson = await stagedResponse.json();
  const staged = stagedJson.data?.stagedUploadsCreate;
  throwOnErrors(staged?.userErrors, "stagedUploadsCreate");
  const target = staged?.stagedTargets?.[0];
  if (!target?.url) throw new Error("No staged upload target returned");

  // 2. POST the bytes to the staged target: every parameter first, file last.
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  const uploadResponse = await fetch(target.url, { method: "POST", body: form });
  if (!uploadResponse.ok) {
    throw new Error(`Staged upload failed (${uploadResponse.status})`);
  }

  // 3. Turn the uploaded file into product media.
  const mediaResponse = await admin.graphql(PRODUCT_CREATE_MEDIA, {
    variables: {
      productId,
      media: [{ mediaContentType: "IMAGE", originalSource: target.resourceUrl }],
    },
  });
  const mediaJson = await mediaResponse.json();
  const created = mediaJson.data?.productCreateMedia;
  throwOnErrors(created?.mediaUserErrors, "productCreateMedia");
  const media = created?.media?.[0];
  if (!media?.id) throw new Error("Product media was not created");

  return { mediaId: media.id, imageUrl: media.image?.url ?? null };
}

/** Sets a variant's image to an existing product media image. */
export async function assignVariantImage(admin, { productId, variantId, mediaId }) {
  const response = await admin.graphql(VARIANTS_BULK_UPDATE, {
    variables: { productId, variants: [{ id: variantId, mediaId }] },
  });
  const json = await response.json();
  throwOnErrors(json.data?.productVariantsBulkUpdate?.userErrors, "productVariantsBulkUpdate");
  const variant = json.data?.productVariantsBulkUpdate?.productVariants?.[0];
  return { imageUrl: variant?.media?.nodes?.[0]?.image?.url ?? null };
}

/** Detaches a media image from a variant, reverting it to the product default. */
export async function clearVariantImage(admin, { productId, variantId, mediaId }) {
  const response = await admin.graphql(VARIANT_DETACH_MEDIA, {
    variables: {
      productId,
      variantMedia: [{ variantId, mediaIds: [mediaId] }],
    },
  });
  const json = await response.json();
  throwOnErrors(json.data?.productVariantDetachMedia?.userErrors, "productVariantDetachMedia");
}
