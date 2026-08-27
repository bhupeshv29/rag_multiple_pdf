import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";

export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2";

export const EMBEDDING_DIM = parseInt(
  process.env.EMBEDDING_DIM ?? "384",
  10,
);

export const COLLECTION_NAME =
  process.env.QDRANT_COLLECTION ?? "case-intelligence";

export const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";

export function createEmbeddings() {
  return new HuggingFaceTransformersEmbeddings({
    model: EMBEDDING_MODEL,
  });
}
