import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getBillingState } from "../models/billing.server";
import { PLANS } from "../lib/plans";
import BillingPaywall from "../components/BillingPaywall";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const billing = await getBillingState(admin);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", billing, plans: PLANS };
};

export default function App() {
  const { apiKey, billing, plans } = useLoaderData();
  const gated = !billing.subscribed && !billing.freeChosen;

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app/home">Home</s-link>
        <s-link href="/app/variants">Products</s-link>
        <s-link href="/app/customization">Customization</s-link>
        <s-link href="/app/plans">Plans</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/help">Help</s-link>
      </s-app-nav>
      {gated ? <BillingPaywall plans={plans} /> : <Outlet />}
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
