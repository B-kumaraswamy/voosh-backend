// src/services/embeddings.js
// ESM (ES6) module
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const JINA_API_KEY = process.env.JINA_API_KEY || "";
// Allow overriding the API URL for testing or proxies
const JINA_API_URL =
  process.env.JINA_API_URL || "https://api.jina.ai/v1/embeddings";

// Default embed dimension for stub (can be changed via env)
export const DIM = parseInt(process.env.EMBED_DIM || "1536", 10);

/**
 * === Helper: deterministic stub embedding ===
 * Produces a repeatable pseudo-embedding for local dev / tests.
 */
function hashToFloat(s, idx) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  h = (h + idx * 2654435761) >>> 0;
  return (h % 10000) / 10000.0;
}
async function stubEmbedText(text) {
  const v = new Array(DIM);
  const input = typeof text === "string" ? text : String(text || "");
  for (let i = 0; i < DIM; i++) {
    v[i] = hashToFloat(input + `|${i}`, i);
  }
  return v;
}
async function stubEmbedTexts(texts = []) {
  const out = [];
  for (const t of texts) {
    /* eslint-disable no-await-in-loop */
    out.push(await stubEmbedText(t));
  }
  return out;
}

/**
 * === Jina embedding calls ===
 *
 * Note: Jina's public API can be called via REST. The exact request/response
 * shape may differ by model/SDK version. This implementation tries a common
 * /embeddings POST shape:
 *
 * POST { model: 'jina_ai/jina-embeddings-v3', input: ['text1','text2'] }
 *
 * Response assumed to contain something like:
 * { data: [{ embedding: [ ... ] }, ...] }  (we handle a few common variants)
 *
 * If the request fails or the response shape is unexpected, we fallback to stub.
 */
async function jinaEmbedTexts(texts = [], options = {}) {
  if (!Array.isArray(texts)) throw new Error("jinaEmbedTexts expects an array");

  if (!JINA_API_KEY) {
    // No key — fallback to local stub
    return stubEmbedTexts(texts);
  }

  // choose model — allow override via env or options
  const model =
    options.model ||
    process.env.JINA_EMBEDDING_MODEL ||
    "jina_ai/jina-embeddings-v3";

  try {
    const payload = {
      model,
      input: texts,
      // other provider-specific params could go here
      // for example: { truncate: 'none' } etc.
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${JINA_API_KEY}`,
    };

    const resp = await axios.post(JINA_API_URL, payload, {
      headers,
      timeout: 120000,
    });

    // Try to find embeddings in common fields
    if (!resp || !resp.data) {
      console.warn("Jina embeddings: empty response, falling back to stub");
      return stubEmbedTexts(texts);
    }

    // Common variant: resp.data.data is an array of objects with `embedding`
    if (
      Array.isArray(resp.data.data) &&
      resp.data.data.length > 0 &&
      resp.data.data[0].embedding
    ) {
      return resp.data.data.map((d) => d.embedding);
    }

    // Another variant: resp.data (itself) is an array of embeddings
    if (Array.isArray(resp.data) && Array.isArray(resp.data[0])) {
      return resp.data;
    }

    // Also handle wrapped responses like { embeddings: [...] }
    if (Array.isArray(resp.data.embeddings)) {
      return resp.data.embeddings;
    }

    // If we couldn't parse embeddings, fallback gracefully
    console.warn(
      "Jina embeddings: unexpected response shape, falling back to stub",
      Object.keys(resp.data)
    );
    return stubEmbedTexts(texts);
  } catch (err) {
    console.error(
      "Jina embeddings request failed — falling back to stub:",
      err.message || err
    );
    return stubEmbedTexts(texts);
  }
}

/**
 * Public API
 */
export async function embedText(text, options = {}) {
  const arr = await jinaEmbedTexts([text], options);
  return arr[0];
}

export async function embedTexts(texts = [], options = {}) {
  return jinaEmbedTexts(texts, options);
}

export default {
  embedText,
  embedTexts,
  DIM,
};
