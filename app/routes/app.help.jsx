import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ACCENTS, PageHero } from "../components/PageDecor";
import { Lightbulb } from "../components/icons";

const FAQS = [
  {
    q: "How do I show the variant selector on my storefront?",
    a: "Open the theme editor from the Home page, add the “Product Variants Widget” app block to your product template, then save. The widget reads your product’s live variants automatically.",
  },
  {
    q: "How many variants can I add?",
    a: "Up to 2,048 variants per product — Shopify's maximum. You can build and edit them from the Products page, and they appear in the storefront widget right away.",
  },
  {
    q: "The widget doesn’t appear on my product page.",
    a: "Make sure you added the app block to the product template (not another template) and clicked Save in the theme editor. Also confirm the product has variants.",
  },
  {
    q: "Can I change the widget layout?",
    a: "Yes. In the theme editor, select the app block and choose Buttons, Dropdown, or Swatches, then set your price and add-to-cart options.",
  },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

export default function Help() {
  const { shop } = useLoaderData();
  const editorUrl = `https://${shop}/admin/themes/current/editor?template=product`;

  return (
    <s-page heading="Help">
      <PageHero
        title="Help"
        subtitle="Set up the widget and find answers to common questions."
        icon={Lightbulb}
        from={ACCENTS.gold}
        to={ACCENTS.orange}
      />

      <s-section heading="Getting started">
        <s-ordered-list>
          <s-list-item>
            Open the theme editor and add the <s-text>Product Variants Widget</s-text>{" "}
            app block to your product template.
          </s-list-item>
          <s-list-item>
            Go to the <s-link href="/app/variants">Products</s-link> page and pick
            a product to build its variants.
          </s-list-item>
          <s-list-item>
            Save your variants — they appear in the storefront widget instantly.
          </s-list-item>
        </s-ordered-list>

        <s-stack direction="inline" gap="base">
          <s-button href={editorUrl} target="_blank">
            Open theme editor
          </s-button>
          <s-button href="/app/variants" variant="tertiary">
            Manage variants
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Frequently asked questions">
        <s-stack direction="block" gap="base">
          {FAQS.map((faq) => (
            <s-box
              key={faq.q}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack direction="block" gap="small">
                <s-text type="strong">{faq.q}</s-text>
                <s-paragraph>{faq.a}</s-paragraph>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Resources">
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/home">Back to Home</s-link>
          </s-list-item>
          <s-list-item>
            <s-link
              href="https://shopify.dev/docs/apps/build/online-store/theme-app-extensions"
              target="_blank"
            >
              Theme app extensions
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link
              href="https://help.shopify.com/manual/products/variants"
              target="_blank"
            >
              About product variants
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Still need help?">
        <s-paragraph>
          Email <s-link href="mailto:apps.kaswebtech@gmail.com">apps.kaswebtech@gmail.com</s-link>{" "}
          and we&apos;ll get back to you.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
