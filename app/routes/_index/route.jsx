import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  // Preserve embedded app params (host, shop, embedded) so App Bridge can
  // still initialize on the destination route.
  const { search } = new URL(request.url);
  return redirect(`/app/home${search}`);
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
