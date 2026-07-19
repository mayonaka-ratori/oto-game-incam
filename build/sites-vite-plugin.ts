import { access, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const STATIC_WORKER = `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || request.method !== "GET") return response;
    const url = new URL(request.url);
    if (url.pathname.includes(".")) return response;
    return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
};
`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Adds the static Cloudflare Worker entrypoint and Sites metadata to the Vite build. */
export function sites(): Plugin {
  let root = process.cwd();
  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      await rm(resolve(root, "dist"), { recursive: true, force: true });
    },
    async closeBundle() {
      const dist = resolve(root, "dist");
      const server = resolve(dist, "server");
      const metadata = resolve(dist, ".openai");
      const hosting = resolve(root, ".openai", "hosting.json");
      await rm(server, { recursive: true, force: true });
      await rm(metadata, { recursive: true, force: true });
      await mkdir(server, { recursive: true });
      await writeFile(resolve(server, "index.js"), STATIC_WORKER, "utf8");
      if (await exists(hosting)) {
        await mkdir(metadata, { recursive: true });
        await copyFile(hosting, resolve(metadata, "hosting.json"));
      }
    },
  };
}
