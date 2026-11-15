// Token Radar — the entrypoint.
//
// Reads the sealed snapshot, ranks the pre-token protocols by implied
// launch value, writes the board and the dashboard's data, copies the
// dashboard and the screenshots into the output directory, and writes
// the dossier the judge reads.
//
//   node main.ts [--input <snapshot.json>] [--output <dir>]
//   MAKEFUN_OUTPUT_DIR sets the output directory when --output is absent.
//   Defaults: /input/snapshot.json and /output.
//
// The program is deterministic: two runs on the same snapshot write
// the same bytes, because every order is fixed (value, then TVL, then
// slug) and nothing reads the clock or any randomness.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard } from "./lib/model.ts";
import type { Snapshot } from "./lib/model.ts";
import { buildDossier } from "./lib/dossier.ts";

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = "/input/snapshot.json";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input" && i + 1 < argv.length) input = argv[++i];
    else if (arg === "--output" && i + 1 < argv.length) output = argv[++i];
    else if (arg.startsWith("--input=")) input = arg.slice("--input=".length);
    else if (arg.startsWith("--output=")) output = arg.slice("--output=".length);
  }
  return { input, output };
}

async function main(): Promise<void> {
  const { input, output } = parseArgs(process.argv.slice(2));
  const repoRoot = path.dirname(fileURLToPath(import.meta.url));
  const snapshot = JSON.parse(fs.readFileSync(input, "utf8")) as Snapshot;
  const board = buildBoard(snapshot);

  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, "board.json"),
    JSON.stringify(
      {
        as_of: board.as_of,
        model: "implied = TVL x growth(7d) x age(no token) x breadth(chains)",
        watchlist_count: board.watchlist_count,
        early_count: board.early_count,
        rows: board.rows,
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(output, "data.js"),
    `window.BOARD = ${JSON.stringify({
      as_of: board.as_of,
      watchlist_count: board.watchlist_count,
      early_count: board.early_count,
      total_implied_usd: board.total_implied_usd,
      rows: board.rows,
    })};\n`,
  );
  fs.cpSync(path.join(repoRoot, "dashboard"), path.join(output, "dashboard"), {
    recursive: true,
  });
  fs.cpSync(path.join(repoRoot, "screenshots"), path.join(output, "screenshots"), {
    recursive: true,
  });
  const dossier = await buildDossier(output, { text_max_bytes: 65536 });
  fs.writeFileSync(path.join(output, "dossier.json"), dossier);

  const top = board.rows[0];
  console.log(`token-radar: ${board.rows.length} rows (${board.watchlist_count} watchlist + ${board.early_count} early)`);
  console.log(`token-radar: rank 1 is ${top.slug} at $${top.implied_value_usd.toLocaleString("en-US")} implied`);
  console.log(`token-radar: dossier ${dossier.length} bytes -> ${path.join(output, "dossier.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
