// Shared plan catalogue for the paywall, Plans page, and billing helpers.
// Paid plans' `amount`/`interval`/`trialDays` are the source of truth for
// the Billing API charge (see app/models/billing.server.js).
export const PLANS = [
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
    recommended: false,
    paid: false,
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
    recommended: true,
    paid: true,
    amount: 9.99,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 7,
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
    recommended: false,
    paid: true,
    amount: 24.99,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 7,
  },
];

/** Look up a plan by its display name (case-insensitive) or id. */
export function findPlan(nameOrId) {
  const key = String(nameOrId || "").toLowerCase();
  return PLANS.find((p) => p.name.toLowerCase() === key || p.id === key) ?? null;
}
