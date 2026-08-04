import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  createSubscription,
  chooseFreePlan,
  cancelActiveSubscription,
  getBillingState,
} from "../models/billing.server";

// Action-only route the paywall and Plans page POST to. Handles buying a paid
// plan (returns Shopify's confirmationUrl) and choosing the Free plan.
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "subscribe") {
    const plan = String(formData.get("plan") || "");
    // eslint-disable-next-line no-undef
    const test = process.env.BILLING_TEST === "true";
    const { confirmationUrl, userErrors } = await createSubscription(admin, {
      plan,
      shop: session.shop,
      test,
    });
    if (userErrors.length > 0 || !confirmationUrl) {
      return { ok: false, userErrors };
    }
    return { ok: true, confirmationUrl };
  }

  if (intent === "free") {
    const { subscriptionId, installationId } = await getBillingState(admin);
    // Choosing Free while on a paid plan: cancel the paid subscription first.
    if (subscriptionId) {
      await cancelActiveSubscription(admin, subscriptionId);
    }
    const { userErrors } = await chooseFreePlan(admin, installationId);
    return { ok: userErrors.length === 0, userErrors };
  }

  return { ok: false, userErrors: [{ message: "Unknown billing action." }] };
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
