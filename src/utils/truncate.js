// src/utils/truncate.js
export function truncateText(text, maxLength = 2000) {
  if (!text) return text;
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…"; // ellipsis
}
