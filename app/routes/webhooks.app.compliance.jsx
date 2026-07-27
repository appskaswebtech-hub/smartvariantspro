import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  // authenticate.webhook verifies the HMAC signature and throws a 401
  // Response if the header is missing or invalid (satisfies HMAC requirement).
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Smart Variants Pro stores no storefront customer data — nothing to return.
      break;
    case "CUSTOMERS_REDACT":
      // No storefront customer data stored — nothing to redact.
      break;
    case "SHOP_REDACT":
      // Fires ~48h after uninstall: purge all data stored for this shop.
      await db.session.deleteMany({ where: { shop } });
      await db.shopSetting.deleteMany({ where: { shop } });
      break;
    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response();
};
