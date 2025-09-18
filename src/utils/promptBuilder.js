// src/utils/promptBuilder.js
// Build a concise RAG prompt: system + retrieved passages + recent messages + question.
// Keep it simple and token-friendly.

import { truncateText } from "./truncate.js";

const DEFAULT_SYSTEM = `You are a helpful assistant. 
Use ONLY the information from the "Retrieved Passages" below to answer the user's question. 
- If the requested information is present in the sources, answer concisely from the sources and elaborate it if necessary. Write the source in a new line (For Ex: Source : article link). 
- If the information is not present, reply appropriately with appropriate disclaimers ("based on the provided sources", "the sources do not mention", etc.).
- Do not invent facts or rely on prior knowledge outside the sources.`;

export function buildPrompt({
  system = DEFAULT_SYSTEM,
  recentMessages = [],
  hits = [],
  question,
  maxContextChars = 5000,
}) {
  // format hits into a retrieval section
  const retrievals = hits
    .map((h, i) => {
      const title = h.title || `source-${i + 1}`;
      const snippet = String(h.text || "").slice(0, 1000); // limit per snippet
      const url = h.url || "";
      return `### Source: ${title}\n${snippet}\nURL: ${url}\n`;
    })
    .join("\n");

  // format recent messages (keep last few)
  const convo = recentMessages
    .slice(-8)
    .map((m) => {
      const role = m.role || "user";
      const txt = String(m.text || "")
        .replace(/\s+/g, " ")
        .trim();
      return `${role.toUpperCase()}: ${truncateText(txt, 800)}`;
    })
    .join("\n");

  // assemble final prompt
  let promptParts = [];
  if (system) promptParts.push(system);
  if (retrievals) {
    promptParts.push("--- Retrieved Passages ---");
    promptParts.push(retrievals);
  }
  if (convo) {
    promptParts.push("--- Conversation ---");
    promptParts.push(convo);
  }
  promptParts.push("--- Question ---");
  promptParts.push(String(question).trim());

  // join and enforce maxContextChars by truncating from the retrieved passages first
  let full = promptParts.join("\n\n");
  if (full.length > maxContextChars) {
    const truncatedRetrievals = truncateText(
      retrievals,
      Math.max(0, maxContextChars - (full.length - retrievals.length))
    );
    full = [
      system,
      "--- Retrieved Passages ---",
      truncatedRetrievals,
      "--- Conversation ---",
      convo,
      "--- Question ---",
      question,
    ].join("\n\n");
  }
  return full;
}
