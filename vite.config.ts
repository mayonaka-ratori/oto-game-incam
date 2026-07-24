import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveAppBuildId } from "./build/app-build-id";
import { sites } from "./build/sites-vite-plugin";

const packageVersion = (
  JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }
).version;
const appBuildId = resolveAppBuildId(
  packageVersion,
  fileURLToPath(new URL(".", import.meta.url)),
);

export default defineConfig({
  plugins: [sites()],
  define: {
    __APP_BUILD_ID__: JSON.stringify(appBuildId),
  },
  build: {
    outDir: "dist/client",
  },
  server: {
    host: "127.0.0.1",
  },
  preview: {
    host: "127.0.0.1",
  },
});
