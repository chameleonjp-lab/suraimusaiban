import { defineConfig, loadEnv } from "vite";
import production from "./config/production.json" with { type: "json" };
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const prod = mode === "production";
  const release = {
    release: production.release,
    siteUrl: production.siteUrl,
    commit: process.env.VITE_DEPLOY_COMMIT ?? "local",
  };
  return {
    plugins: [
      {
        name: "publication-metadata",
        transformIndexHtml() {
          return [
            {
              tag: "meta",
              attrs: { name: "chameleonjp-commit", content: release.commit },
              injectTo: "head",
            },
          ];
        },
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "release.json",
            source: JSON.stringify(release),
          });
        },
      },
    ],
    base:
      process.env.VITE_BASE_PATH ??
      env.VITE_BASE_PATH ??
      (prod ? production.basePath : "/"),
    define: prod
      ? {
          "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
            process.env.VITE_SUPABASE_URL ??
              env.VITE_SUPABASE_URL ??
              production.supabaseUrl,
          ),
          "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
            process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
              env.VITE_SUPABASE_PUBLISHABLE_KEY ??
              production.supabasePublishableKey,
          ),
        }
      : {},
    build: { target: "es2022" },
    server: {
      hmr: process.env.SLIME_DISABLE_HMR ? false : undefined,
      port: 5173,
      strictPort: true,
    },
  };
});
