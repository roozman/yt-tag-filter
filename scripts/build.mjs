import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const sourceDirectory = path.join(projectRoot, "src");
const distributionDirectory = path.join(projectRoot, "dist");
const browserTargets = ["chrome", "firefox"];
const sharedFiles = [
  "content.css",
  "content.js",
  "matcher.js",
  "options.css",
  "options.html",
  "options.js"
];

await rm(distributionDirectory, { recursive: true, force: true });
await mkdir(distributionDirectory, { recursive: true });

for (const browser of browserTargets) {
  const targetDirectory = path.join(distributionDirectory, browser);
  await mkdir(targetDirectory, { recursive: true });

  for (const file of sharedFiles) {
    await cp(path.join(sourceDirectory, file), path.join(targetDirectory, file));
  }

  const manifestSource = path.join(sourceDirectory, `manifest.${browser}.json`);
  const manifest = JSON.parse(await readFile(manifestSource, "utf8"));
  await writeFile(
    path.join(targetDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

console.log("Built unpacked extensions in dist/chrome and dist/firefox.");

