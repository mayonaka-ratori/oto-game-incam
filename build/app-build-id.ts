import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { relative, resolve } from "node:path";

const BUILD_INPUT_PATHS = [
  "src",
  "build",
  "public",
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
] as const;

const REVISION_ENV_KEYS = [
  "GITHUB_SHA",
  "CF_PAGES_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "SOURCE_VERSION",
  "COMMIT_SHA",
] as const;

interface BuildContent {
  readonly path: string;
  readonly content: Uint8Array;
}

export function resolveAppBuildId(
  packageVersion: string,
  rootDirectory: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const explicit = environment.VITE_APP_BUILD_ID?.trim();
  if (explicit) return explicit;

  const revision = REVISION_ENV_KEYS
    .map((key) => environment[key]?.trim())
    .find((value): value is string => Boolean(value));
  if (revision) return `${packageVersion}+${normalizeRevision(revision)}`;

  return createContentBuildId(packageVersion, collectBuildContent(rootDirectory));
}

export function createContentBuildId(
  packageVersion: string,
  inputs: readonly BuildContent[],
): string {
  const hash = createHash("sha256");
  for (const input of [...inputs].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(input.path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(input.content);
    hash.update("\0");
  }
  return `${packageVersion}+src.${hash.digest("hex").slice(0, 12)}`;
}

function collectBuildContent(rootDirectory: string): BuildContent[] {
  return BUILD_INPUT_PATHS.flatMap((path) => collectPath(rootDirectory, resolve(rootDirectory, path)));
}

function collectPath(rootDirectory: string, path: string): BuildContent[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .sort()
      .flatMap((entry) => collectPath(rootDirectory, resolve(path, entry)));
  }
  return [{
    path: relative(rootDirectory, path),
    content: readFileSync(path),
  }];
}

function normalizeRevision(revision: string): string {
  const normalized = revision.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40);
  return normalized || "unknown";
}
