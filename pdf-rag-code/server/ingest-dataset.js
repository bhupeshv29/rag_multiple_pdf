import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestPdf } from "./ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default to the bundled test data sitting next to the project folder.
const DEFAULT_DOCS_DIR = path.join(
  __dirname,
  "..",
  "..",
  "transcript_w_docs",
  "docs_for_test",
);
const DEFAULT_TRANSCRIPTS_DIR = path.join(
  __dirname,
  "..",
  "..",
  "transcript_w_docs",
  "transcriptions_for_test",
);

function listPdfs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => path.join(dir, f));
}

async function main() {
  const docsDir = process.env.DOCS_DIR ?? DEFAULT_DOCS_DIR;
  const transcriptsDir =
    process.env.TRANSCRIPTS_DIR ?? DEFAULT_TRANSCRIPTS_DIR;

  const files = [...listPdfs(docsDir), ...listPdfs(transcriptsDir)];

  console.log(`Found ${files.length} PDF(s) to ingest.`);

  let total = 0;
  let failed = 0;

  for (const file of files) {
    try {
      total += await ingestPdf(file);
    } catch (err) {
      failed += 1;
      console.error(`  !! failed to ingest ${path.basename(file)}: ${err.message}`);
    }
  }

  console.log(
    `\n✅ Done. Chunks inserted: ${total}${failed ? ` | failed: ${failed}` : ""}`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
