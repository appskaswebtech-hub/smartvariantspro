import { useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getBillingState } from "../models/billing.server";
import { PLANS } from "../lib/plans";
import { ACCENTS, PageHero } from "../components/PageDecor";
import { Rocket } from "../components/icons";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const billing = await getBillingState(admin);
  return { plans: PLANS, currentPlan: billing.activePlan ?? "Free" };
};

export default function Plans() {
  const { plans, currentPlan } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const data = fetcher.data;
    if (!data || !data.ok) return;
    if (data.confirmationUrl) {
      // eslint-disable-next-line no-undef
      window.open(data.confirmationUrl, "_top");
    } else {
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const choose = (plan) => {
    const formData = new FormData();
    if (plan.paid) {
      formData.append("intent", "subscribe");
      formData.append("plan", plan.name);
    } else {
      formData.append("intent", "free");
    }
    fetcher.submit(formData, { method: "POST", action: "/app/subscribe" });
  };

  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.userErrors ?? [] : [];

  return (
    <s-page heading="Plans">
      <PageHero
        title="Plans"
        subtitle="Pick the plan that fits your store — upgrade or downgrade any time."
        icon={Rocket}
        from={ACCENTS.violet}
        to={ACCENTS.orange}
      />

      {errors.length > 0 && (
        <s-banner tone="critical" heading="Couldn't update your plan">
          <s-unordered-list>
            {errors.map((e, i) => (
              <s-list-item key={i}>{e.message}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      <s-section heading="Choose the plan that fits your store">
        <s-paragraph>
          Upgrade or downgrade any time. Choosing a paid plan opens Shopify&apos;s
          secure billing page, and charges appear on your regular Shopify invoice.
        </s-paragraph>

        <s-grid
          gridTemplateColumns="1fr 1fr 1fr"
          gap="base"
          paddingBlockStart="base"
        >
          {plans.map((plan) => {
            // Shopify may return the plan by display name ("Pro") or handle
            // ("pro"), so compare case-insensitively.
            const isCurrent =
              plan.name.toLowerCase() === String(currentPlan).toLowerCase();
            return (
              <s-box
                key={plan.id}
                padding="large"
                borderWidth="base"
                borderRadius="base"
                borderColor={plan.recommended ? "strong" : "base"}
                background={plan.recommended ? "subdued" : "transparent"}
              >
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-heading>{plan.name}</s-heading>
                    {plan.recommended && (
                      <s-badge tone="info">Recommended</s-badge>
                    )}
                    {isCurrent && (
                      <s-badge tone="success">Current plan</s-badge>
                    )}
                  </s-stack>

                  <s-stack direction="inline" gap="small" alignItems="baseline">
                    <s-text type="strong">{plan.price}</s-text>
                    <s-text color="subdued">{plan.cadence}</s-text>
                  </s-stack>

                  <s-paragraph>{plan.description}</s-paragraph>

                  <s-unordered-list>
                    {plan.features.map((feature) => (
                      <s-list-item key={feature}>{feature}</s-list-item>
                    ))}
                  </s-unordered-list>

                  <s-button
                    variant={plan.recommended ? "primary" : "secondary"}
                    disabled={isCurrent || busy}
                    onClick={() => choose(plan)}
                  >
                    {isCurrent
                      ? "Current plan"
                      : plan.paid
                        ? `Upgrade to ${plan.name}`
                        : "Switch to Free"}
                  </s-button>
                </s-stack>
              </s-box>
            );
          })}
        </s-grid>
      </s-section>

      <s-section slot="aside" heading="Billing">
        <s-paragraph>
          Billing is handled by Shopify, so charges appear on your regular
          Shopify invoice. You can change or cancel your plan any time from here.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
