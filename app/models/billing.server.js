// App handle used to build the Managed Pricing URL. Must match `handle` in
// shopify.app.toml and the app handle in the Partner Dashboard.
const APP_HANDLE = "smart-variants-pro";

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
      }
    }
  }`;

/**
 * Returns the active paid plan name (e.g. "Pro"), or "Free" when the shop has
 * no active subscription. Reads the subscription straight from Shopify via the
 * Admin GraphQL API, so Managed Pricing changes are reflected without any local
 * state to keep in sync.
 */
export async function getActivePlan(admin) {
  const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
  const json = await response.json();
  const subscriptions =
    json.data?.currentAppInstallation?.activeSubscriptions ?? [];
  const active = subscriptions.find((sub) => sub.status === "ACTIVE");
  return active?.name ?? "Free";
}

/**
 * Builds the Shopify-hosted Managed Pricing plan-selection page for a shop.
 * `shop` is the myshopify domain, e.g. "example.myshopify.com".
 */
export function managedPricingUrl(shop) {
  const storeHandle = shop.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
}
