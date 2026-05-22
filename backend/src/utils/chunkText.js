function normalizeText(input = '') {
  return String(input || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(input = '', chunkSize = 1200, overlap = 200) {
  const text = normalizeText(input);
  if (!text) return [];

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

module.exports = { normalizeText, chunkText };
