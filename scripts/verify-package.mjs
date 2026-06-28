import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const required = [
  "package.json",
  "openclaw.plugin.json",
  "README.md",
  "SECURITY.md",
  "PRIVACY.md",
  "CAPABILITIES.md",
  "CHANGELOG.md",
  "LICENSE",
  "dist/index.js",
  "dist/suno-production/knowledge-bundle.js",
  "ui/dist/index.html"
];

let ok = true;
for (const file of required) {
  if (!existsSync(file)) {
    console.error(`missing required file: ${file}`);
    ok = false;
  }
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (!pkg.openclaw?.extensions?.length) { console.error("package.json openclaw.extensions is required"); ok = false; }
if (!pkg.openclaw?.compat?.pluginApi) { console.error("package.json openclaw.compat.pluginApi is required"); ok = false; }
if (!pkg.openclaw?.compat?.minGatewayVersion) { console.error("package.json openclaw.compat.minGatewayVersion is required"); ok = false; }

const manifest = JSON.parse(readFileSync("openclaw.plugin.json", "utf8"));
for (const key of ["id", "name", "description", "main", "configSchema"]) {
  if (!(key in manifest)) { console.error(`openclaw.plugin.json ${key} is required`); ok = false; }
}

// v10.7 — ensure tarball ships the inline knowledge bundle and does not double-ship
// the original Markdown sources. The bundle keeps prompt builders path-independent
// for distribution; raw .md sources stay in src/ for `--write` regeneration but
// must not be carried in the package.
try {
  const pack = JSON.parse(execSync("npm pack --dry-run --json", { encoding: "utf8" }));
  const tarballFiles = pack[0]?.files?.map((entry) => entry.path) ?? [];
  const hasKnowledgeBundle = tarballFiles.includes("dist/suno-production/knowledge-bundle.js");
  if (!hasKnowledgeBundle) {
    console.error("tarball missing dist/suno-production/knowledge-bundle.js (v10.7 inline bundle)");
    ok = false;
  }
  const leakedKnowledge = tarballFiles.filter((path) => /^src\/suno-production\/knowledge\/.+\.md$/.test(path));
  if (leakedKnowledge.length > 0) {
    console.error(`tarball still ships ${leakedKnowledge.length} legacy .md source(s) under src/suno-production/knowledge/ (remove from package.json files)`);
    ok = false;
  }
  const leakedWorkspacePersona = tarballFiles.filter((path) =>
    /^(ARTIST|SOUL|PRODUCER|IDENTITY|INNER)\.md$/.test(path) ||
    /^\.local\//.test(path) ||
    /^(runtime|songs|logs|observations)\//.test(path) ||
    (/PRODUCER\.md$/.test(path) && path !== "workspace-template/PRODUCER.md")
  );
  if (leakedWorkspacePersona.length > 0) {
    console.error(`tarball includes local workspace persona/runtime file(s): ${leakedWorkspacePersona.join(", ")}`);
    ok = false;
  }
  const producerTemplate = readFileSync("workspace-template/PRODUCER.md", "utf8");
  const producerTemplateLooksPrivate =
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(producerTemplate) ||
    /\+?\d[\d\s().-]{8,}\d/.test(producerTemplate) ||
    /\bbot\d+:[A-Za-z0-9_-]{30,}\b|(?:^|\W)(?:TELEGRAM_BOT_TOKEN|API[_ -]?KEY|TOKEN|COOKIE|CREDENTIAL|PASSWORD|SECRET)\s*[:=]\s*[A-Za-z0-9+/=_-]{8,}/i.test(producerTemplate);
  if (producerTemplateLooksPrivate) {
    console.error("workspace-template/PRODUCER.md contains private-looking contact or secret-like sample data");
    ok = false;
  }
} catch (error) {
  console.error(`npm pack inspection failed: ${error instanceof Error ? error.message : String(error)}`);
  ok = false;
}

if (!ok) process.exit(1);
console.log("package verification passed");
