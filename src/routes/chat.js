// src/routes/chat.js
// Streaming-only chat route via SSE
// POST /chat { sessionId?: string, message: string }
// Always streams responses; client must accept SSE.

import express from "express";
import sessionStore from "../services/sessionStore.js";
import vectorClient from "../services/vectorClient.mjs";
import llmClient from "../services/llmClient.js";
import { v4 as uuidv4 } from "uuid";
import { buildPrompt } from "../utils/promptBuilder.js";

const router = express.Router();



function dedupeHits(hits = []) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const key = (h.url || h.title || "").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

// add near top of router.post handler or file-level top, e.g. after dedupeHits/formatSources:
const MAX_OUTPUT_TOKENS = parseInt(process.env.RAG_MAX_TOKENS || process.env.LLM_MAX_OUTPUT_TOKENS || "1024", 10);
const MAX_CONTEXT_CHARS = parseInt(process.env.RAG_MAX_CONTEXT_CHARS || "5000", 10);


function formatSources(hits = [], maxSources = 6) {
  return (hits || [])
    .slice(0, maxSources)
    .map((h) => ({ title: h.title || null, url: h.url || null }));
}

router.post("/", async (req, res) => {
  try {
    const { sessionId: incomingSessionId, message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message (string) is required" });
    }

    // create session if not provided
    let sessionId = incomingSessionId;
    if (!sessionId) {
      // createSession may return an id string or an object with id — handle both
      const created = await sessionStore.createSession
        ? await sessionStore.createSession({ title: "New chat" })
        : null;
      sessionId = created && created.id ? created.id : created || uuidv4();
    }

    // Append user message
    await sessionStore.appendMessage(sessionId, {
      role: "user",
      text: message,
      ts: Date.now(),
    });

    const topK = parseInt(process.env.RAG_TOPK || "4", 10);
    const rawHits = await vectorClient.search(message, topK);
    const hits = dedupeHits(rawHits);
    const maxSources = parseInt(process.env.RAG_MAX_SOURCES || "6", 10);
    const sources = formatSources(hits, maxSources);

    const recent = await sessionStore.getMessages(sessionId, 8);

    const prompt = buildPrompt({
      recentMessages: recent,
      hits,
      question: message,
      maxContextChars: MAX_CONTEXT_CHARS,
    });

    // --- Always streaming via SSE ---
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // send initial session id event
    res.write(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`);

    let assistantBuffer = "";

    // called for each chunk
    const onChunk = async (chunk) => {
      assistantBuffer += chunk;
      // stream incremental chunk to client
      res.write(`event: message\ndata: ${JSON.stringify({ delta: chunk })}\n\n`);
    };

    try {
      // opts control chunking behavior of generateStream
      const streamOpts = { chunkSize: parseInt(process.env.LLM_CHUNK_SIZE || "120", 10), delayMs: parseInt(process.env.LLM_CHUNK_DELAY_MS || "20", 10), maxOutputTokens: MAX_OUTPUT_TOKENS };
      await llmClient.generateStream(prompt, streamOpts, onChunk);

      // persist final assistant message
      await sessionStore.appendMessage(sessionId, {
        role: "assistant",
        text: assistantBuffer,
        ts: Date.now(),
      });

      // Send done event with final metadata (sources + answer)
      res.write(
        `event: done\ndata: ${JSON.stringify({
          sessionId,
          answer: assistantBuffer,
          sources,
        })}\n\n`
      );
      res.end();
    } catch (err) {
      console.error("LLM stream error", err);
      res.write(
        `event: error\ndata: ${JSON.stringify({
          error: err.message || String(err),
        })}\n\n`
      );
      res.end();
    }
  } catch (err) {
    console.error("chat handler error", err);
    // if headers not sent, respond JSON; otherwise send SSE error
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || "internal error" });
    }
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || "internal error" })}\n\n`);
    res.end();
  }
});

export default router;
