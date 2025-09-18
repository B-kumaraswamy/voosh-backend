// src/services/llmClient.js
// Streaming-only LLM client for Gemini (simulated streaming).
// - generateStream(prompt, opts, onChunk): emits chunks via onChunk()
// Env vars:
// - GEMINI_API_KEY
// - GEMINI_MODEL
// - LLM_STUB_ENABLED ("true" to force the stub)

import axios from "axios";  // Replace fetch with axios
import "dotenv/config";

const KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

/* ----------------- Helpers ----------------- */
function chunkString(s, n) {
  if (!s) return [];
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}
function maybeDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 0));
}

/* ----------------- Stub ----------------- */
function stubResponse(prompt) {
  const preview = String(prompt).slice(0, 300).replace(/\s+/g, " ");
  return `STUB RESPONSE — echo of prompt (first 300 chars):\n\n${preview}\n\n(Enable GEMINI_API_KEY to call real API.)`;
}

/* ----------------- Internal: non-streaming call used by streaming wrapper ----------------- */
async function callGeminiGenerate(prompt, opts = {}) {
  if (process.env.LLM_STUB_ENABLED === "true" || !KEY) {
    return { text: stubResponse(prompt), raw: null, stub: true };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    MODEL
  )}:generateContent?key=${encodeURIComponent(KEY)}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (typeof opts.maxOutputTokens === "number") {
  body.generationConfig = { maxOutputTokens: opts.maxOutputTokens };
}

  try {
    const resp = await axios.post(url, body, {
      headers: { "Content-Type": "application/json" },
    });

    const data = resp.data;

    // Extract text from possible shapes
    let text = "";
    try {
      if (Array.isArray(data?.candidates) && data.candidates.length > 0) {
        const c = data.candidates[0];
        if (Array.isArray(c?.content?.parts)) {
          text = c.content.parts.map((p) => p.text || "").join("\n");
        } else if (typeof c?.output?.text === "string") {
          text = c.output.text;
        }
      } else if (Array.isArray(data?.output?.items)) {
        text = data.output.items.map((it) => it.text || "").join("");
      } else if (typeof data?.output?.text === "string") {
        text = data.output.text;
      } else {
        text = JSON.stringify(data).slice(0, 2000);
      }
    } catch (e) {
      text = JSON.stringify(data).slice(0, 1000);
    }

    return { text, raw: data };
  } catch (err) {
    const msg = err.response ? JSON.stringify(err.response.data) : `status ${err.response.status} ${err.response.statusText}`;
    const apiErr = new Error(`Gemini API error: ${msg}`);
    apiErr.raw = err.response?.data || null;
    throw apiErr;
  }
}

/**
 * generateStream(prompt, opts, onChunk)
 * - onChunk(chunk) may be async
 * - opts:
 *    - chunkSize (default 120)
 *    - delayMs (default 20)
 *    - maxOutputTokens (optional)
 */
export async function generateStream(prompt, opts = {}, onChunk = () => {}) {
  // stub path: produce a deterministic stub and stream it
  if (process.env.LLM_STUB_ENABLED === "true" || !KEY) {
    const stub = stubResponse(prompt);
    const chunks = chunkString(stub, opts.chunkSize || 120);
    for (const c of chunks) {
      await maybeDelay(opts.delayMs || 20);
      // allow consumer to be async
      // eslint-disable-next-line no-await-in-loop
      await onChunk(c);
    }
    return { ok: true, stub: true };
  }

  // Real provider: Gemini doesn't provide streaming over REST in this shape,
  // so do a single call then chunk the result to simulate streaming.
  const result = await callGeminiGenerate(prompt, opts);
  const text = result.text || "";
  const chunks = chunkString(text, opts.chunkSize || 120);

  for (const c of chunks) {
    await maybeDelay(opts.delayMs || 20);
    // eslint-disable-next-line no-await-in-loop
    await onChunk(c);
  }

  return { ok: true, raw: result.raw || null };
}

export default { generateStream };
