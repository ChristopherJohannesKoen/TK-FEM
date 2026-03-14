import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distPublicDir = path.join(rootDir, "dist", "public");
const rootIndexPath = path.join(rootDir, "index.html");
const rootAssetsDir = path.join(rootDir, "assets");

async function assertBuildExists() {
  try {
    const distStats = await stat(distPublicDir);
    if (!distStats.isDirectory()) {
      throw new Error();
    }
  } catch {
    throw new Error("Build output not found. Run `npm run build` before `npm run export:static`.");
  }
}

async function exportStaticSite() {
  await assertBuildExists();

  await rm(rootIndexPath, { force: true });
  await rm(rootAssetsDir, { recursive: true, force: true });

  await cp(path.join(distPublicDir, "index.html"), rootIndexPath);
  await cp(path.join(distPublicDir, "assets"), rootAssetsDir, { recursive: true });

  console.log("Exported dist/public to the repository root.");
}

await exportStaticSite();
