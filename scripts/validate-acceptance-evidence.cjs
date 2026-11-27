const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const matrixPath = path.join(root, "docs", "planning", "CAPABILITY_MATRIX.md");
const matrix = fs.readFileSync(matrixPath, "utf8");
const lines = matrix.split(/\r?\n/).filter((line) => /^\| [^|-].* \| (working|partial|planned) \|/.test(line));
if (lines.length < 10) throw new Error("Could not find current product capability rows in CAPABILITY_MATRIX.md.");

const missing = [];
for (const line of lines) {
  const area = line.split("|")[1].trim();
  const evidenceCell = line.split("|")[3] ?? "";
  const links = [...evidenceCell.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  if (links.length === 0) {
    missing.push(`${area}: no evidence link`);
    continue;
  }
  for (const link of links) {
    if (/^(https?:|mailto:)/i.test(link)) continue;
    const target = link.split("#", 1)[0];
    if (!target) continue;
    const resolved = path.resolve(path.dirname(matrixPath), target);
    if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) missing.push(`${area}: missing evidence target ${link}`);
  }
}
if (missing.length) throw new Error(`Capability matrix evidence is incomplete:\n- ${missing.join("\n- ")}`);

const acceptance = fs.readFileSync(path.join(root, "docs", "operations", "ACCEPTANCE_EVIDENCE.md"), "utf8");
const roadmap = fs.readFileSync(path.join(root, "docs", "planning", "SKAI_OVERHAUL_OPPORTUNITIES.md"), "utf8");
const implementedSlices = [...roadmap.matchAll(/^## Slice (\d+) —[^\r\n]*\r?\n([\s\S]*?)(?=^## Slice |\r?\n---\s*$)/gm)]
  .filter((match) => match[2].includes("**Implementation status"))
  .map((match) => match[1]);
const missingSliceRecords = implementedSlices.filter((slice) => !new RegExp(`^### Slice ${slice}(?:\\D|$)`, "m").test(acceptance));
if (missingSliceRecords.length) throw new Error(`Implemented roadmap slices are missing acceptance records: ${missingSliceRecords.join(", ")}`);
for (const required of ["Success check", "Failure check", "Disposable profile", "Before screenshot", "Network and privacy boundary", "Unverified platforms"]) {
  if (!acceptance.includes(required)) throw new Error(`Acceptance evidence contract is missing ${required}.`);
}

const screenshotWriter = fs.readFileSync(path.join(root, "scripts", "smoke-electron-ui-matrix.cjs"), "utf8");
for (const field of ["platform", "viewport", "theme", "sidebar", "runtime", "route", "capturedAt"]) {
  if (!screenshotWriter.includes(`${field}:`)) throw new Error(`UI matrix screenshot sidecars do not record ${field}.`);
}
if (!screenshotWriter.includes("${target}.evidence.json")) throw new Error("UI matrix screenshot sidecar naming contract is missing.");

const readinessPath = path.join(root, "docs", "operations", "RELEASE_READINESS.md");
const readiness = fs.readFileSync(readinessPath, "utf8");
if (!readiness.includes("Unverified platforms and integrations") || !readiness.includes("Native macOS")) {
  throw new Error("Release readiness must summarize unverified platforms and integrations.");
}

const releaseWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
for (const gate of ["npm run check:acceptance-evidence", "npm run smoke:image:runtime-unavailable", "UI_MATRIX_EXERCISE_SETTINGS_OVERLAY"]) {
  if (!releaseWorkflow.includes(gate)) throw new Error(`Release workflow is missing the evidence gate ${gate}.`);
}

if (process.argv[2]) {
  const sidecarPath = path.resolve(process.cwd(), process.argv[2]);
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  const screenshotPath = sidecarPath.replace(/\.evidence\.json$/i, "");
  for (const key of ["platform", "osRelease", "architecture", "viewport", "theme", "sidebar", "runtime", "route", "appRevision", "capturedAt"]) {
    if (sidecar[key] == null || sidecar[key] === "") throw new Error(`Screenshot evidence sidecar is missing ${key}.`);
  }
  if (sidecar.schema !== "skai-ui-evidence/v1" || !fs.existsSync(screenshotPath)) throw new Error("Screenshot evidence sidecar is invalid or its PNG is missing.");
}

console.log(`Acceptance evidence contract passed: ${lines.length} capability rows link to existing evidence; ${implementedSlices.length} implemented roadmap slices have acceptance records; UI metadata and release limitations are documented${process.argv[2] ? "; screenshot sidecar validated" : ""}.`);
