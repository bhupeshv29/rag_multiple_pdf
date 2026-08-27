import "dotenv/config";

import { Worker } from "bullmq";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import "dotenv/config";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log(`GEMINI_API_KEY : ${GEMINI_API_KEY}`);
console.log(`OPENROUTER_API_KEY : ${OPENROUTER_API_KEY}`);

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

new Worker(
  "file-upload-queue",
  async (job) => {
    try {
      console.log("========== NEW JOB ==========");

      const { path } = job.data;

      console.log("Loading PDF...");

      const loader = new PDFLoader(path);

      const docs = await loader.load();

      console.log(`Pages : ${docs.length}`);

      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 150,
      });

      const splitDocs = await splitter.splitDocuments(docs);

      console.log(`Chunks : ${splitDocs.length}`);

      console.log("Connecting Qdrant...");

      const vectorStore = await QdrantVectorStore.fromDocuments(
        [],
        embeddings,
        {
          url: "http://localhost:6333",
          collectionName: "langchainjs-testing",
        },
      );

      console.log("Generating embeddings...");

      await vectorStore.addDocuments(splitDocs);

      console.log("✅ Documents inserted into Qdrant");
    } catch (err) {
      console.error(err);
    }
  },
  {
    connection: {
      host: "localhost",
      port: 6379,
    },
  },
);

console.log("✅ Worker Started");
