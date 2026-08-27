import express from "express";
import cors from "cors";
import multer from "multer";
import { Queue } from "bullmq";
import { GoogleGenAI } from "@google/genai";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import "dotenv/config";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const app = express();

app.use(express.json());
app.use(cors());

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

const queue = new Queue("file-upload-queue", {
  connection: {
    host: "localhost",
    port: 6379,
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

app.post("/upload/pdf", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No PDF uploaded",
      });
    }

    await queue.add("file-ready", {
      filename: req.file.originalname,
      path: req.file.path,
    });

    return res.json({
      success: true,
      message: "PDF Uploaded Successfully",
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
        url: "http://localhost:6333",
        collectionName: "langchainjs-testing",
      },
    );

    const retriever = vectorStore.asRetriever({
      k: 3,
    });

    const docs = await retriever.invoke(query);

    const context = docs
      .map((doc) => doc.pageContent)
      .join("\n\n----------------------\n\n");

    // Stream response
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    res.flushHeaders?.();

    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",

      contents: `
            You are an AI RAG: Case Intelligence System.
            Answer ONLY using the provided PDF context.
            If the answer isn't present, simply reply:
            "I couldn't find that information in the PDF."

            Context:
            ${context}
            Question:
            ${query}
            `,
    });

    // Send retrieved docs first
    res.write(
      JSON.stringify({
        type: "docs",
        docs,
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
