import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const templateRoot = resolve(here, "gongkao-coach");
const outRoot = resolve(repoRoot, "dist", "gongkao-coach");

const mcpUrl = process.env.MCP_URL;
const developerName = process.env.DEVELOPER_NAME;

if (!mcpUrl) throw new Error("MCP_URL is required");
if (!developerName) throw new Error("DEVELOPER_NAME is required");

const parsedUrl = new URL(mcpUrl);
if (parsedUrl.protocol !== "https:") {
  throw new Error("MCP_URL must use HTTPS for public plugin submission");
}

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

cpSync(resolve(templateRoot, "skills"), resolve(outRoot, "skills"), { recursive: true });
cpSync(resolve(templateRoot, "assets"), resolve(outRoot, "assets"), { recursive: true });

const pluginTemplate = readFileSync(resolve(templateRoot, "plugin.template.json"), "utf8");
const mcpTemplate = readFileSync(resolve(templateRoot, "mcp.template.json"), "utf8");

const pluginJson = pluginTemplate.replaceAll("__DEVELOPER_NAME__", developerName);
const mcpJson = mcpTemplate.replaceAll("__MCP_URL__", mcpUrl);

if (pluginJson.includes("__") || mcpJson.includes("__")) {
  throw new Error("Unresolved plugin template placeholders remain");
}

JSON.parse(pluginJson);
JSON.parse(mcpJson);

writeFileSync(resolve(outRoot, "plugin.json"), pluginJson);
writeFileSync(resolve(outRoot, "mcp.json"), mcpJson);

for (const name of ["LICENSE", "PRIVACY.md", "TERMS.md"]) {
  const source = resolve(repoRoot, name);
  if (existsSync(source)) cpSync(source, resolve(outRoot, name));
}

console.log(`Built public plugin package at ${outRoot}`);
console.log("Next: zip the contents of dist/gongkao-coach/ and upload that ZIP.");
