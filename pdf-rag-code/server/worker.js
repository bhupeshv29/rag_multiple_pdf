import "dotenv/config";

import { Worker } from "bullmq";
import { ingestPdf } from "./ingest.js";

new Worker(
  "file-upload-queue",
  async (job) => {
    try {
      console.log("========== NEW JOB ==========");

      const { path, filename } = job.data;

      console.log(`File : ${filename ?? path}`);

      await ingestPdf(path, filename);

      console.log("✅ Documents inserted into Qdrant");
    } catch (err) {
      console.error(`!! Job failed: ${err?.message ?? err}`);
    }
  },
  {
    connection: {
      host: process.env.REDIS_HOST ?? "localhost",
      port: process.env.REDIS_PORT ?? 6379,
    },
  },
);

console.log("✅ Worker Started");
