import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const distDir = join(projectRoot, "dist");
const staticOutputDir = join(projectRoot, ".vercel", "output", "static");
const filesToRemoveFromVercelOutput = [".htaccess", "_headers", "_redirects"];

if (!existsSync(distDir)) {
  throw new Error(`Missing Vite output at ${distDir}. Run the Vite build first.`);
}

rmSync(staticOutputDir, { recursive: true, force: true });
mkdirSync(staticOutputDir, { recursive: true });
cpSync(distDir, staticOutputDir, { recursive: true });

for (const fileName of filesToRemoveFromVercelOutput) {
  rmSync(join(staticOutputDir, fileName), { force: true });
}

console.log(`Copied build output from ${distDir} to ${staticOutputDir}`);
