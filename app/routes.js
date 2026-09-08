import { flatRoutes } from "@react-router/fs-routes";

// Ignore editor-backup files (e.g. a stray `app.variants.jsx.save` left by
// editing on the server) so they aren't treated as route modules and break
// the build.
export default flatRoutes({
  ignoredRouteFiles: ["**/*.save", "**/*.bak", "**/*.orig", "**/*~"],
});
