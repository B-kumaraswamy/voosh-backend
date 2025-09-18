// src/services/vectorClient.js
import "dotenv/config";
import { QdrantClient } from '@qdrant/js-client-rest';
import { embedTexts } from './embeddings.js';
import { v4 as uuidv4 } from 'uuid';   // <--- add this

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = process.env.QDRANT_COLLECTION || 'articles';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';

const client = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY });

async function ensureCollection(dim) {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);
  if (!exists) {
    console.log(`Creating collection "${COLLECTION}" with dim=${dim}...`);
    await client.createCollection(COLLECTION, {
      vectors: {
        size: dim,
        distance: 'Cosine',
      },
    });
  }
}

async function upsert(items = []) {
  if (!Array.isArray(items) || items.length === 0) return;

  const vectors = await embedTexts(items.map((x) => x.text));

  const points = items.map((item, i) => ({
    id: item.id || uuidv4(),   // ✅ generate UUID if none provided
    vector: vectors[i],
    payload: {
      text: item.text,
      title: item.title || null,
      url: item.url || null,
    },
  }));

  await ensureCollection(vectors[0].length);
  await client.upsert(COLLECTION, { points });
  return { inserted: points.length };
}

async function search(query, topK = 5) {
  const [vector] = await embedTexts([query]);
  await ensureCollection(vector.length);
  const result = await client.search(COLLECTION, {
    vector,
    limit: topK,
  });
  return result.map((r) => ({
    score: r.score,
    text: r.payload.text,
    title: r.payload.title,
    url: r.payload.url,
  }));
}

async function countVectors() {
  try {
    const info = await client.count(COLLECTION, { exact: true });
    return info.count;
  } catch {
    return 0;
  }
}

export default {
  upsert,
  search,
  countVectors,
  ensureCollection,
};
