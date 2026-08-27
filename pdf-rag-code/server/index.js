import express from "express";
import cors from "cors";
import multer from "multer";
import { Queue } from "bullmq";
import { GoogleGenAI } from "@google/genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import {
  COLLECTION_NAME,
  QDRANT_URL,
  createEmbeddings,
} from "./embeddings.js";
import "dotenv/config";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const app = express();

app.use(express.json());
app.use(cors());

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

const embeddings = createEmbeddings();

const queue = new Queue("file-upload-queue", {
  connection: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: process.env.REDIS_PORT ?? 6379,
  },
});

const storage = multer.diskStorage({
  destination(_, __, cb) {
    cb(null, "uploads/");
  },

  filename(_, file, cb) {
    cb(
      null,
      `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`,
    );
  },
});

const upload = multer({ storage });

app.get("/", (_, res) => {
  res.json({
    status: "Server Running 🚀",
  });
});

app.post("/upload/pdf", upload.array("pdf", 20), async (req, res) => {
  try {
    const files = req.files ?? [];

    if (!files.length) {
      return res.status(400).json({
        success: false,
        message: "No PDF uploaded",
      });
    }

    for (const file of files) {
      await queue.add("file-ready", {
        filename: file.originalname,
        path: file.path,
      });
    }

    return res.json({
      success: true,
      message: `${files.length} PDF${files.length > 1 ? "s" : ""} Uploaded Successfully`,
      count: files.length,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Upload failed",
    });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    const query = String(message ?? "").trim();

    if (!query) {
      return res.status(400).json({
        error: "message missing",
      });
    }

    const vectorStore = await QdrantVectorStore.fromExistingCollection(
      embeddings,
      {
        url: QDRANT_URL,
        collectionName: COLLECTION_NAME,
      },
    );

    const retriever = vectorStore.asRetriever({
      k: 8,
    });

    const docs = await retriever.invoke(query);

    const context = docs
      .map((doc) => {
        const { source, docType, client } = doc.metadata ?? {};
        const page = doc.metadata?.loc?.pageNumber;

        return [
          `[source: ${source ?? "-"} | type: ${docType ?? "-"} | client: ${client ?? "-"} | page: ${page ?? "-"}]`,
          doc.pageContent,
        ].join("\n");
      })
      .join("\n\n----------------------\n\n");

    // Stream response
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    res.flushHeaders?.();

    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",

      contents: `
            You are an AI RAG: Case Intelligence System.
            You answer open-ended questions about a set of client transcripts and reference documents.
            Ground your answer in the provided context below. It comes from multiple sources,
            each labelled with [source | type | client | page].
            - Answer the question directly and thoroughly.
            - If the answer is not present in the context, simply reply:
              "I couldn't find that information in the provided documents."
            - Do not use outside knowledge beyond the context.
            - Where relevant, synthesise across multiple sources (e.g. several client transcripts,
              or a transcript and a policy document).

            Context:
            ${context}
            Question:
            ${query}
            `,
    });

    // Send retrieved docs first (with full metadata for evidence)
    res.write(
      JSON.stringify({
        type: "docs",
        docs: docs.map((doc) => ({
          pageContent: doc.pageContent,
          metadata: doc.metadata ?? {},
        })),
      }) + "\n__DOCS_END__\n",
    );

    for await (const chunk of stream) {
      const text = chunk.text ?? "";

      if (!text) continue;

      res.write(text);
    }

    res.end();
  } catch (err) {
    console.error(err);

    if (!res.headersSent) {
      return res.status(500).json({
        error: "Internal Server Error",
      });
    }

    res.end();
  }
});

app.listen(8000, () => {
  console.log("🚀 Server running on http://localhost:8000");
});
