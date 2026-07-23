import { redirect } from "react-router";

export const loader = ({ request }) => {
  const { search } = new URL(request.url);
  // The app's entry URL always lands on Home: /app forwards to /app/home, and
  // unauthenticated visitors are sent on to /auth/login from there. The search
  // string is carried through so App Bridge can initialize on the destination.
  throw redirect(`/app${search}`);
};
