import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ACCENTS, PageHero } from "../components/PageDecor";
import { Sparkles } from "../components/icons";

const THEME_EXTENSION_HANDLE = "variant-selector";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return {
    shop: session.shop,
    // Set THEME_EXTENSION_UUID in your env after `shopify app dev`/`deploy`
    // to enable one-click block insertion. Until then the button opens the
    // product template in the theme editor and the merchant adds the block.
    // eslint-disable-next-line no-undef
    themeExtensionUuid: process.env.THEME_EXTENSION_UUID || "",
  };
};

export default function Home() {
  const { shop, themeExtensionUuid } = useLoaderData();

  const baseEditorUrl = `https://${shop}/admin/themes/current/editor?template=product`;
  const editorUrl = themeExtensionUuid
    ? `${baseEditorUrl}&addAppBlockId=${themeExtensionUuid}/${THEME_EXTENSION_HANDLE}&target=mainSection`
    : baseEditorUrl;

  return (
    <s-page heading="Home">
      <s-button slot="primary-action" href={editorUrl} target="_blank">
        Open theme editor
      </s-button>

      <PageHero
        title="Smart Variants Pro"
        subtitle="Offer up to 2,048 variants and show them with a custom storefront selector."
        icon={Sparkles}
        from={ACCENTS.indigo}
        to={ACCENTS.blue}
      />

      <s-section heading="Add up to 2,048 variants to your products 🎉">
        <s-paragraph>
          Smart Variants Pro lets you offer up to 2,048 variant combinations on a
          product and display them with a custom selector on your storefront. To
          show the selector, add the <s-text>Smart Variants Pro Widget</s-text> app
          block to your product page in the theme editor.
        </s-paragraph>

        <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base" paddingBlockStart="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <div style={{ height: "4px", width: "40px", borderRadius: "999px", background: ACCENTS.teal }} />
              <s-icon type="product" />
              <s-text type="strong">Up to 2,048 variants</s-text>
              <s-text color="subdued">
                Build every size, color, and style combination for a product.
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <div style={{ height: "4px", width: "40px", borderRadius: "999px", background: ACCENTS.orange }} />
              <s-icon type="store" />
              <s-text type="strong">Custom storefront widget</s-text>
              <s-text color="subdued">
                Show variants as buttons, dropdowns, or swatches on the product
                page.
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <div style={{ height: "4px", width: "40px", borderRadius: "999px", background: ACCENTS.green }} />
              <s-icon type="refresh" />
              <s-text type="strong">Always in sync</s-text>
              <s-text color="subdued">
                Variants you add here appear in the storefront widget instantly.
              </s-text>
            </s-stack>
          </s-box>
        </s-grid>

        <s-stack direction="inline" gap="base" paddingBlockStart="base">
          <s-button href="/app/variants" variant="primary">
            Manage variants
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Get started">
        <s-ordered-list>
          <s-list-item>
            <s-text>Open the theme editor</s-text> — use the button above to jump
            to your product template.
          </s-list-item>
          <s-list-item>
            In the theme editor, click <s-text>Add block</s-text> in the product
            section and choose <s-text>Smart Variants Pro Widget</s-text> under the
            Apps group. Configure the layout, price, and button label, then save.
          </s-list-item>
          <s-list-item>
            Head to the <s-link href="/app/variants">Products</s-link> page to
            build the variant combinations for your products.
          </s-list-item>
        </s-ordered-list>

        <s-stack direction="inline" gap="base">
          <s-button href={editorUrl} target="_blank">
            Open theme editor
          </s-button>
          <s-button href="/app/variants" variant="tertiary">
            Go to Products
          </s-button>
        </s-stack>

        {!themeExtensionUuid && (
          <s-paragraph>
            <s-text color="subdued">
              Tip: after running <s-text>shopify app dev</s-text> or{" "}
              <s-text>shopify app deploy</s-text>, set the{" "}
              <s-text>THEME_EXTENSION_UUID</s-text> environment variable to your
              extension&apos;s ID to make this button insert the block
              automatically.
            </s-text>
          </s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          The widget reads your product&apos;s live options and variants directly
          from the theme, so any variants you add in Shopify appear in the
          selector automatically.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Need help?">
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/help">View the help guide</s-link>
          </s-list-item>
          <s-list-item>
            <s-link
              href="https://shopify.dev/docs/apps/build/online-store/theme-app-extensions"
              target="_blank"
            >
              About theme app extensions
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
