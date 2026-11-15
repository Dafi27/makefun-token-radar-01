// The dossier builder: assembles dossier.json from an output directory.
//
// The dossier is what the judge reads: the dashboard's screenshots,
// then the dashboard's source as text. This builder writes the same
// bytes the kit's buildDossier writes for the same files, so the gate's
// dossier check passes: the envelope is
//   {"cover":0,"images":[{"base64","media_type","name","sha256"}],
//    "schema":"makefun/dossier/v1","text":"..."}
//
// The text opens with a ## Dashboard block (the file count, the bytes,
// every file's path with its size), then a ## Source block with each
// text file's path, size and line count and its contents in a fenced
// block by path, every file in path order. The text holds at most
// text_max_bytes: a file that does not fit goes in up to its last
// complete line that fits, with a line saying how many of its lines are
// not shown, and a last line names how many whole files and bytes were
// left out.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export const DOSSIER_SCHEMA = "makefun/dossier/v1";
export const DOSSIER_MAX_BYTES = 4_194_304;
export const DOSSIER_MAX_IMAGES = 8;
export const SCREENSHOT_MAX_BYTES = 524_288;

export class DossierError extends Error {}

const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const TEXT_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".md",
  ".txt",
]);

const FENCE_LANGUAGE: Record<string, string> = {
  ".html": "html",
  ".css": "css",
  ".js": "js",
  ".mjs": "js",
  ".json": "json",
  ".svg": "svg",
  ".md": "md",
  ".txt": "text",
};

function isPlainName(name: string): boolean {
  return PLAIN_NAME.test(name);
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

interface DashboardFile {
  name: string;
  bytes: number;
  content: string;
  isText: boolean;
}

function listFilesSorted(dir: string): string[] {
  const names: string[] = [];
  const walk = (current: string, rel: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relPath);
      } else if (entry.isFile()) {
        names.push(relPath);
      }
    }
  };
  walk(dir, "");
  return names.sort();
}

function countLines(content: string): number {
  if (content === "") return 0;
  const newlines = (content.match(/\n/g) ?? []).length;
  return newlines + (content.endsWith("\n") ? 0 : 1);
}

// Canonical JSON: object keys sorted recursively, compact separators,
// the way the dossier envelope is written.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function buildText(files: DashboardFile[], maxBytes: number): string {
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const head = [`## Dashboard`, ``, `Files: ${files.length} (${totalBytes} bytes)`];
  for (const file of files) {
    head.push(`- ${file.name} (${file.bytes} bytes)`);
  }
  head.push(``, `## Source`, ``);
  const textFiles = files.filter((file) => file.isText);
  const parts: string[] = [head.join("\n")];
  let usedBytes = Buffer.byteLength(parts[0], "utf8");
  let omittedFiles = 0;
  let omittedBytes = 0;
  for (let i = 0; i < textFiles.length; i++) {
    const file = textFiles[i];
    const ext = path.extname(file.name).toLowerCase();
    const lang = FENCE_LANGUAGE[ext] ?? "";
    const lines = countLines(file.content);
    const block = `\n### ${file.name}\n\n${file.bytes} bytes, ${lines} ${lines === 1 ? "line" : "lines"}\n\n\`\`\`${lang}\n${file.content}${file.content.endsWith("\n") ? "" : "\n"}\`\`\`\n`;
    const blockBytes = Buffer.byteLength(block, "utf8");
    if (usedBytes + blockBytes <= maxBytes) {
      parts.push(block);
      usedBytes += blockBytes;
      continue;
    }
    // The file does not fit whole: keep as many complete lines as fit,
    // then a line saying how many of its lines are not shown.
    const header = `\n### ${file.name}\n\n${file.bytes} bytes, ${lines} ${lines === 1 ? "line" : "lines"}\n\n\`\`\`${lang}\n`;
    const headerBytes = Buffer.byteLength(header, "utf8");
    const budget = maxBytes - usedBytes - headerBytes;
    const contentLines = file.content.split("\n");
    let kept = "";
    let keptLines = 0;
    for (const line of contentLines) {
      const next = kept + line + "\n";
      if (Buffer.byteLength(next, "utf8") > budget) break;
      kept = next;
      keptLines++;
    }
    const remaining = lines - keptLines;
    const tail = `${kept}(${remaining} lines not shown)\n\`\`\`\n`;
    parts.push(header + tail);
    omittedFiles = textFiles.length - i - 1;
    omittedBytes = textFiles
      .slice(i + 1)
      .reduce((sum, f) => sum + f.bytes, 0);
    parts.push(
      `\n${omittedFiles} files (${omittedBytes} bytes) not shown.\n`,
    );
    return parts.join("");
  }
  void omittedFiles;
  void omittedBytes;
  return parts.join("");
}

export async function buildDossier(
  outDir: string,
  opts: { text_max_bytes: number },
): Promise<Uint8Array> {
  const dashboardDir = path.join(outDir, "dashboard");
  const screenshotsDir = path.join(outDir, "screenshots");
  if (!fs.existsSync(dashboardDir)) {
    throw new DossierError(`dashboard/ not found in ${outDir}`);
  }
  const dashboardNames = listFilesSorted(dashboardDir);
  const files: DashboardFile[] = [];
  for (const name of dashboardNames) {
    for (const part of name.split("/")) {
      if (!isPlainName(part)) {
        throw new DossierError(`dashboard file name not plain: ${name}`);
      }
    }
    const full = path.join(dashboardDir, name);
    const content = fs.readFileSync(full);
    const ext = path.extname(name).toLowerCase();
    files.push({
      name,
      bytes: content.length,
      content: content.toString("utf8"),
      isText: TEXT_EXTENSIONS.has(ext),
    });
  }
  if (!fs.existsSync(screenshotsDir)) {
    throw new DossierError("screenshots/ is empty");
  }
  const shotNames = listFilesSorted(screenshotsDir);
  if (shotNames.length === 0) {
    throw new DossierError("screenshots/ is empty");
  }
  if (shotNames.length > DOSSIER_MAX_IMAGES) {
    throw new DossierError(`too many screenshots: ${shotNames.length}`);
  }
  const images = [];
  for (const name of shotNames) {
    if (!isPlainName(name)) {
      throw new DossierError(`screenshot name not plain: ${name}`);
    }
    const ext = path.extname(name).toLowerCase();
    if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
      throw new DossierError(`screenshot is not a PNG or JPEG: ${name}`);
    }
    const raw = fs.readFileSync(path.join(screenshotsDir, name));
    if (raw.length > SCREENSHOT_MAX_BYTES) {
      throw new DossierError(`screenshot past its byte cap: ${name}`);
    }
    const mediaType = isPng(raw)
      ? "image/png"
      : isJpeg(raw)
        ? "image/jpeg"
        : null;
    if (mediaType === null) {
      throw new DossierError(`screenshot is not a whole PNG or JPEG: ${name}`);
    }
    images.push({
      base64: raw.toString("base64"),
      media_type: mediaType,
      name,
      sha256: crypto.createHash("sha256").update(raw).digest("hex"),
    });
  }
  const text = buildText(files, opts.text_max_bytes);
  const dossier = {
    cover: 0,
    images,
    schema: DOSSIER_SCHEMA,
    text,
  };
  const bytes = new TextEncoder().encode(canonicalJson(dossier));
  if (bytes.length > DOSSIER_MAX_BYTES) {
    throw new DossierError(`dossier past its byte cap: ${bytes.length} bytes`);
  }
  return bytes;
}
