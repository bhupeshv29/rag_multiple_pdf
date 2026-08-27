import "dotenv/config";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { QdrantVectorStore } from "@langchain/qdrant";
import { inferMetadata } from "./metadata.js";
import { COLLECTION_NAME, QDRANT_URL, createEmbeddings } from "./embeddings.js";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 8000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Extract a suggested retry delay from Google's quota/retry error, if present.
function suggestedDelayMs(msg) {
  const m = /retry in\s+([\d.]+)\s*s/i.exec(msg ?? "");
  return m ? Math.round(parseFloat(m[1]) * 1000) : null;
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err?.message ?? String(err);

      const retriable = /rate|quota|429|empty|timeout|temporar|resource/i.test(
        msg,
      );

      if (!retriable || attempt === MAX_RETRIES) {
        throw new Error(`[${label}] ${msg}`);
      }

      const delay = suggestedDelayMs(msg) ?? RETRY_DELAY_MS + attempt * 2000;

      console.warn(
        `  ! ${label} attempt ${attempt}/${MAX_RETRIES} failed (${msg}). Retrying in ${delay}ms...`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

export async function ingestPdf(filePath, filename) {
  const realName = filename ?? filePath.split(/[\\/]/).pop();
  const meta = inferMetadata(realName);

  console.log(`\nIngesting : ${realName} (${meta.docType}/${meta.client})`);

  const loader = new PDFLoader(filePath);

  let docs;
  await withRetry(async () => {
    docs = await loader.load();
  }, "load");

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 150,
  });

  const splitDocs = await splitter.splitDocuments(docs);

  for (const doc of splitDocs) {
    doc.metadata = {
      ...doc.metadata,
      source: realName,
      docType: meta.docType,
      client: meta.client,
    };
  }

  // Drop chunk boundaries that have no real content to avoid empty embeddings.
  const cleanDocs = splitDocs.filter((d) => d.pageContent.trim().length > 0);

  if (cleanDocs.length !== splitDocs.length) {
    console.warn(
      `  -> dropped ${splitDocs.length - cleanDocs.length} empty chunk(s)`,
    );
  }

  const embeddings = createEmbeddings();

  let vectorStore;
  await withRetry(async () => {
    vectorStore = await QdrantVectorStore.fromDocuments([], embeddings, {
      url: QDRANT_URL,
      collectionName: COLLECTION_NAME,
    });
  }, "connect");

  const BATCH_SIZE = 8;
  let insertedCount = 0;

  for (let i = 0; i < cleanDocs.length; i += BATCH_SIZE) {
    const batch = cleanDocs.slice(i, i + BATCH_SIZE);

    try {
      await withRetry(async () => {
        await vectorStore.addDocuments(batch);
      }, `batch ${i}-${i + batch.length}`);
      insertedCount += batch.length;
    } catch (err) {
      console.warn(`  ! skipped batch ${i}-${i + batch.length}: ${err.message}`);
    }
  }

  console.log(
    `  -> ${insertedCount}/${cleanDocs.length} chunks inserted${
      insertedCount < cleanDocs.length ? " (some skipped)" : ""
    }`,
  );

  return insertedCount;
}
