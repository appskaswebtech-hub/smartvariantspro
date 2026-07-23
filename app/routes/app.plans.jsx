import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ACCENTS, PageHero } from "../components/PageDecor";
import { Rocket } from "../components/icons";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "forever",
    description: "Get started and try the variant widget on one product.",
    features: [
      "100 product",
      "Up to 2,048 variants per product",
      "Buttons, dropdown & swatches layouts",
      "Community support",
    ],
    cta: "Current plan",
    recommended: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$9.99",
    cadence: "per month",
    description: "For growing stores that need variants everywhere.",
    features: [
      "Unlimited products",
      "Up to 2,048 variants per product",
      "Buttons, dropdown & swatches layouts",
      "Priority email support",
    ],
    cta: "Upgrade to Pro",
    recommended: true,
  },
  {
    id: "advanced",
    name: "Advanced",
    price: "$24.99",
    cadence: "per month",
    description: "Advanced controls and the fastest support.",
    features: [
      "Everything in Pro",
      "Bulk variant editing",
      "Custom widget styling",
      "1-hour support response",
    ],
    cta: "Upgrade to Advanced",
    recommended: false,
  },
];

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Hardcoded for now; billing wiring comes in a later milestone.
  return { plans: PLANS, currentPlan: "free" };
};

export default function Plans() {
  const { plans, currentPlan } = useLoaderData();

  return (
    <s-page heading="Plans">
      <PageHero
        title="Plans"
        subtitle="Pick the plan that fits your store — upgrade or downgrade any time."
        icon={Rocket}
        from={ACCENTS.violet}
        to={ACCENTS.orange}
      />

      <s-section heading="Choose the plan that fits your store">
        <s-paragraph>
          Upgrade any time. Prices are placeholders while checkout is being set
          up — selecting a paid plan doesn&apos;t charge you yet.
        </s-paragraph>

        <s-grid
          gridTemplateColumns="1fr 1fr 1fr"
          gap="base"
          paddingBlockStart="base"
        >
          {plans.map((plan) => {
            const isCurrent = plan.id === currentPlan;
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
                    disabled={isCurrent}
                  >
                    {isCurrent ? "Current plan" : plan.cta}
                  </s-button>
                </s-stack>
              </s-box>
            );
          })}
        </s-grid>
      </s-section>

      <s-section slot="aside" heading="Billing">
        <s-paragraph>
          Plans will be handled through Shopify billing, so charges appear on
          your regular Shopify invoice. Nothing is charged during this preview.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
