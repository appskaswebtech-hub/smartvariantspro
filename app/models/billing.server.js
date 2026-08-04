import { findPlan } from "../lib/plans";

// App handle used to build the post-approval return URL. Must match `handle`
// in shopify.app.toml and the app handle in the Partner Dashboard.
const APP_HANDLE = "smart-variants-pro";

// App-owned metafield that records a merchant's choice of the Free plan, so the
// paywall stays dismissed even though there's no Shopify subscription for Free.
const PLAN_NAMESPACE = "smart_variants_pro";
const PLAN_CHOICE_KEY = "plan_choice";

const BILLING_STATE_QUERY = `#graphql
  query BillingState {
    currentAppInstallation {
      id
      activeSubscriptions { id name status test }
      metafield(namespace: "${PLAN_NAMESPACE}", key: "${PLAN_CHOICE_KEY}") { value }
    }
  }`;

const APP_SUBSCRIPTION_CREATE = `#graphql
  mutation CreateSubscription(
    $name: String!
    $returnUrl: URL!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $test: Boolean
    $trialDays: Int
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      lineItems: $lineItems
      test: $test
      trialDays: $trialDays
      replacementBehavior: STANDARD
    ) {
      confirmationUrl
      appSubscription { id status }
      userErrors { field message }
    }
  }`;

const APP_SUBSCRIPTION_CANCEL = `#graphql
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }`;

const METAFIELDS_SET = `#graphql
  mutation SetPlanChoice($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }`;

/**
 * Reads the shop's billing state in one query: the active subscription (if any)
 * and whether the merchant has chosen the Free plan.
 * Returns { activePlan, subscribed, subscriptionId, freeChosen, installationId }.
 */
export async function getBillingState(admin) {
  const response = await admin.graphql(BILLING_STATE_QUERY);
  const json = await response.json();
  const install = json.data?.currentAppInstallation;
  const active = (install?.activeSubscriptions ?? []).find(
    (sub) => sub.status === "ACTIVE",
  );
  return {
    activePlan: active?.name ?? (install?.metafield?.value === "free" ? "Free" : null),
    subscribed: Boolean(active),
    subscriptionId: active?.id ?? null,
    freeChosen: install?.metafield?.value === "free",
    installationId: install?.id ?? null,
  };
}

/**
 * Creates an app subscription for a paid plan and returns Shopify's
 * confirmationUrl (the billing page the merchant must approve). `test` creates
 * a test charge that isn't really billed.
 */
export async function createSubscription(admin, { plan, shop, test }) {
  const config = findPlan(plan);
  if (!config || !config.paid) {
    return { userErrors: [{ message: `Unknown paid plan: ${plan}` }] };
  }

  const storeHandle = shop.replace(".myshopify.com", "");
  const returnUrl = `https://admin.shopify.com/store/${storeHandle}/apps/${APP_HANDLE}`;

  const response = await admin.graphql(APP_SUBSCRIPTION_CREATE, {
    variables: {
      name: config.name,
      returnUrl,
      test: Boolean(test),
      trialDays: config.trialDays ?? 0,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: config.amount, currencyCode: config.currencyCode },
              interval: config.interval,
            },
          },
        },
      ],
    },
  });
  const json = await response.json();
  const result = json.data?.appSubscriptionCreate;
  return {
    confirmationUrl: result?.confirmationUrl ?? null,
    userErrors: result?.userErrors ?? [],
  };
}

/** Cancels an active subscription (used when switching to Free). */
export async function cancelActiveSubscription(admin, subscriptionId) {
  if (!subscriptionId) return { userErrors: [] };
  const response = await admin.graphql(APP_SUBSCRIPTION_CANCEL, {
    variables: { id: subscriptionId },
  });
  const json = await response.json();
  return { userErrors: json.data?.appSubscriptionCancel?.userErrors ?? [] };
}

/**
 * Records the Free-plan choice on an app-owned metafield so the paywall stays
 * dismissed. Needs the app installation id as the metafield owner.
 */
export async function chooseFreePlan(admin, installationId) {
  const ownerId = installationId ?? (await getBillingState(admin)).installationId;
  if (!ownerId) {
    return { userErrors: [{ message: "Could not resolve the app installation." }] };
  }
  const response = await admin.graphql(METAFIELDS_SET, {
    variables: {
      metafields: [
        {
          ownerId,
          namespace: PLAN_NAMESPACE,
          key: PLAN_CHOICE_KEY,
          type: "single_line_text_field",
          value: "free",
        },
      ],
    },
  });
  const json = await response.json();
  return { userErrors: json.data?.metafieldsSet?.userErrors ?? [] };
}
