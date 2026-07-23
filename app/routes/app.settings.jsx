import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ACCENTS, PageHero } from "../components/PageDecor";
import { Gear } from "../components/icons";

const DEFAULTS = {
  showPrice: true,
  showAvailability: true,
  addToCartLabel: "Add to cart",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const setting = await prisma.shopSetting.findUnique({
    where: { shop: session.shop },
  });

  return { settings: setting ?? DEFAULTS };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const data = {
    showPrice: formData.get("showPrice") === "true",
    showAvailability: formData.get("showAvailability") === "true",
    addToCartLabel: String(
      formData.get("addToCartLabel") || DEFAULTS.addToCartLabel,
    ),
  };

  await prisma.shopSetting.upsert({
    where: { shop: session.shop },
    update: data,
    create: { shop: session.shop, ...data },
  });

  return { ok: true };
};

export default function Settings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const isSaving =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.data, shopify]);

  const save = () => {
    const form = document.getElementById("settings-form");
    if (!form) return;
    const formData = new FormData(form);
    fetcher.submit(formData, { method: "POST" });
  };

  return (
    <s-page heading="Settings">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(isSaving ? { loading: true } : {})}
      >
        Save
      </s-button>

      <PageHero
        title="Settings"
        subtitle="Set the widget defaults applied across your storefront."
        icon={Gear}
        from={ACCENTS.blue}
        to={ACCENTS.teal}
      />

      <s-section heading="Widget defaults">
        {fetcher.data?.ok && (
          <s-banner tone="success" heading="Settings saved" />
        )}

        <fetcher.Form method="post" id="settings-form">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Add to cart button label"
              name="addToCartLabel"
              value={settings.addToCartLabel}
            />

            <s-switch
              label="Show price"
              name="showPrice"
              value="true"
              {...(settings.showPrice ? { checked: true } : {})}
            />

            <s-switch
              label="Show availability"
              name="showAvailability"
              value="true"
              {...(settings.showAvailability ? { checked: true } : {})}
            />

            <s-stack direction="inline" gap="base">
              <s-button
                type="button"
                variant="primary"
                onClick={save}
                {...(isSaving ? { loading: true } : {})}
              >
                Save
              </s-button>
            </s-stack>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section slot="aside" heading="About these defaults">
        <s-paragraph>
          These are convenience defaults for the storefront widget. The values
          that actually render on a product page come from the app block&apos;s
          settings in the theme editor, which you can adjust per product
          template. To change how variants are displayed and the widget&apos;s
          theme color, use the Customization page.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
