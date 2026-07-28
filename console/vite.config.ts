import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The console is served by LCS itself under /_lcs/ui/, so production is same-origin
// with the AWS API on port 4566 and needs no CORS handling.
//
// The `_lcs` prefix is load-bearing, not cosmetic: path-style S3 addresses buckets at
// /{bucket}/{key}, so a console served at /console/ would be shadowed by a bucket named
// "console". Bucket names must start with a lowercase letter or digit, so nothing under
// a leading-underscore prefix can ever collide.
//
// In dev, Vite serves the app and proxies every non-app path to the emulator so the
// same-origin assumption holds there too. Anything that is not a Vite asset or an app
// route is emulator traffic: AWS paths are service-shaped (/bucket/key,
// /2015-03-31/functions/...) and cannot be enumerated.
//
// The trailing (\/|$) is required — without it, /_lcs/uiXYZ and any bucket sharing a
// prefix with a Vite path would be wrongly treated as app assets.
const APP_PATHS = /^\/(_lcs\/ui|@vite|@react-refresh|@fs|@id|src|node_modules|favicon\.ico)(\/|$)/;

export default defineConfig({
  base: "/_lcs/ui/",
  plugins: [react()],
  resolve: {
    alias: {
      "@shell": resolvePath("./src/shell"),
      "@platform": resolvePath("./src/platform"),
      "@services": resolvePath("./src/services"),
    },
  },
  build: {
    outDir: "../src/main/resources/META-INF/resources/_lcs/ui",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Must include the bare "/" path. AWS Query-protocol services (EC2, IAM, STS, SQS,
      // SNS, CloudFormation) POST to the root, so excluding "/" sends them to Vite and
      // they fail with an XML parse error on the returned HTML. The app itself lives
      // under /_lcs/ui/, so nothing needs "/" — the bypass below protects app assets.
      "^/": {
        target: process.env.LCS_ENDPOINT ?? "http://localhost:4566",
        changeOrigin: false,
        bypass(req) {
          if (req.url && APP_PATHS.test(req.url)) {
            return req.url;
          }
          return undefined;
        },
      },
    },
  },
});
