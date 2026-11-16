#!/usr/bin/env node

/* Exercises only disposable project and workspace files. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const zlib = require("node:zlib");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const hostAssembly = ensureSmokeAgentHostBuild(root);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skai-project-browser-smoke-"));
const workspace = path.join(tempRoot, "workspace");
fs.mkdirSync(path.join(workspace, "node_modules"), { recursive: true });
fs.mkdirSync(path.join(workspace, "src", "features", "coding"), { recursive: true });
fs.mkdirSync(path.join(workspace, "assets"), { recursive: true });
fs.writeFileSync(path.join(workspace, "README.md"), "safe metadata fixture\n");
fs.writeFileSync(path.join(workspace, "src", "features", "coding", "page.tsx"), "export const page = true;\n");
fs.writeFileSync(path.join(workspace, "assets", "pixel.png"), makePng());
fs.writeFileSync(path.join(workspace, "assets", "invalid.png"), "not an image");
fs.writeFileSync(path.join(workspace, "assets", "guide.pdf"), makePdf("Safe PDF Preview Text"));
fs.writeFileSync(path.join(workspace, "assets", "large-guide.pdf"), Buffer.concat([makePdf("Safe large PDF fallback text"), Buffer.alloc(8 * 1024 * 1024)]));
fs.writeFileSync(path.join(workspace, ".env"), "SECRET=must-not-appear\n");
fs.writeFileSync(path.join(workspace, "node_modules", "ignored.js"), "ignored\n");

const child = spawn("dotnet", [hostAssembly, "--stdio"], {
  cwd: root,
  env: { ...process.env, SKAI_SKIP_LEGACY_DATA_MIGRATION: "true", SRAI_PROJECTS_PATH: path.join(tempRoot, "projects.json") },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const reader = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
let stderr = "";
child.stderr.on("data", chunk => { stderr += chunk.toString(); });
reader.on("line", line => {
  try {
    const response = JSON.parse(line);
    const resolve = pending.get(response.id);
    if (resolve) { pending.delete(response.id); resolve(response); }
  } catch { /* timeout reports malformed host output */ }
});

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const body = Buffer.concat([name, data]);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(pngCrc32(body));
  return Buffer.concat([size, body, crc]);
}

function makePng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", zlib.deflateSync(Buffer.from([0, 32, 128, 220, 255]))), pngChunk("IEND", Buffer.alloc(0))]);
}

function makePdf(text) {
  const stream = `BT /F1 12 Tf 24 700 Td (${text}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

function request(method, params) {
  const id = `browser-smoke-${nextId++}`;
  child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, 10_000);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
  });
}

async function run() {
  const saved = await request("project.save", { name: "Browser smoke", folderPaths: [workspace] });
  if (!saved.ok || typeof saved.result?.id !== "string") throw new Error("project.save did not create the disposable project.");
  const browser = await request("project.files", { id: saved.result.id });
  const files = browser.result?.files ?? [];
  const paths = files.map(file => file.relativePath.replaceAll("\\", "/"));
  if (!browser.ok || files.length !== 6 || !paths.includes("README.md") || !paths.includes("src/features/coding/page.tsx")
    || !files.some(file => file.relativePath.replaceAll("\\", "/") === "assets/pixel.png" && file.kind === "image")
    || !files.some(file => file.relativePath.replaceAll("\\", "/") === "assets/invalid.png" && file.kind === "image")
    || !files.some(file => file.relativePath.replaceAll("\\", "/") === "assets/guide.pdf" && file.kind === "pdf")
    || !files.some(file => file.relativePath.replaceAll("\\", "/") === "assets/large-guide.pdf" && file.kind === "pdf"))
    throw new Error(`project.files did not preserve nested paths, safe filtering, and visual preview kinds: ${JSON.stringify(files)}`);
  if (browser.result.protectedFilesSkipped < 1 || browser.result.excludedDirectoriesSkipped < 1)
    throw new Error("project.files did not report protected/dependency exclusions.");
  if (Object.values(files[0]).some(value => String(value).includes("SECRET"))) throw new Error("project browser leaked protected content.");
  const image = await request("project.preview.read", { id: saved.result.id, relativePath: "assets/pixel.png" });
  if (!image.ok || image.result?.kind !== "image" || image.result.mediaType !== "image/png" || !image.result.content)
    throw new Error("project.preview.read did not return a validated local PNG preview.");
  const pdf = await request("project.preview.read", { id: saved.result.id, relativePath: "assets/guide.pdf" });
  if (!pdf.ok || pdf.result?.kind !== "pdf" || pdf.result.mediaType !== "application/pdf" || !pdf.result.content)
    throw new Error("project.preview.read did not return the bounded inline PDF payload.");
  const largePdf = await request("project.preview.read", { id: saved.result.id, relativePath: "assets/large-guide.pdf" });
  if (!largePdf.ok || largePdf.result?.kind !== "pdf" || largePdf.result.mediaType !== "text/plain" || !largePdf.result.content.includes("Safe large PDF fallback text"))
    throw new Error("project.preview.read did not preserve the selectable-text fallback for a large PDF.");
  const protectedPreview = await request("project.preview.read", { id: saved.result.id, relativePath: ".env" });
  if (protectedPreview.ok) throw new Error("project.preview.read opened a protected file.");
  const malformedImage = await request("project.preview.read", { id: saved.result.id, relativePath: "assets/invalid.png" });
  if (malformedImage.ok) throw new Error("project.preview.read accepted an invalid image signature.");
  const traversal = await request("project.preview.read", { id: saved.result.id, relativePath: "../secret.png" });
  if (traversal.ok) throw new Error("project.preview.read accepted a path outside the project.");
  console.log("Project browser smoke passed: nested listing, safe filtering, bounded PNG/PDF previews, protected/malformed/traversal rejection, and exclusion summary.");
}

run().catch(error => {
  console.error(error.message);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
}).finally(() => {
  child.kill();
  reader.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
