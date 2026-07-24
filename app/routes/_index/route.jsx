import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import { Form, redirect, useLoaderData } from "react-router";
import { login } from "../../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  // Embedded launch / install: Shopify appends ?shop=...&host=...&embedded=1.
  // Keep forwarding those into the app so App Bridge initializes correctly.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  // Direct browser visit: stay on the root URL and show the landing page.
  return { showForm: Boolean(login) };
};

export default function Index() {
  const { showForm } = useLoaderData();
  const [shop, setShop] = useState("");

  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Smart Variants Pro">
          <s-text>
            Beautiful variant selectors for your Shopify storefront.
          </s-text>
          {showForm && (
            <Form method="post" action="/auth/login">
              <s-text-field
                name="shop"
                label="Shop domain"
                details="example.myshopify.com"
                value={shop}
                onChange={(e) => setShop(e.currentTarget.value)}
                autocomplete="on"
              ></s-text-field>
              <s-button type="submit">Log in</s-button>
            </Form>
          )}
        </s-section>
      </s-page>
    </AppProvider>
  );
}
