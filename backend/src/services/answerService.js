const OpenAI = require('openai');
const env = require('../config/env');

const client = env.openAiKey ? new OpenAI({ apiKey: env.openAiKey }) : null;

async function buildGroundedAnswer({ clientName, question, chunks }) {
  if (!chunks.length) {
    return {
      answer: 'I could not find this in active care documents. Please escalate to a supervisor or nurse before proceeding.',
      citations: [],
      grounded: false
    };
  }

  const citations = chunks.slice(0, 4).map((chunk) => ({
    chunkId: String(chunk._id),
    sourceFileName: chunk.sourceMeta.sourceFileName,
    sectionHint: chunk.sourceMeta.sectionHint || '',
    excerpt: chunk.content.slice(0, 280)
  }));

  if (!client) {
    return {
      answer: `Based on available care-plan text for ${clientName}, follow the cited protocol snippets exactly. If any detail is unclear, escalate immediately.`,
      citations,
      grounded: true
    };
  }

  const contextText = chunks
    .slice(0, 6)
    .map((chunk, idx) => `[Source ${idx + 1}] ${chunk.sourceMeta.sourceFileName} | ${chunk.sourceMeta.sectionHint}\n${chunk.content}`)
    .join('\n\n');

  const prompt = [
    'You are a compliance-first disability care assistant.',
    'Rules:',
    '1) Answer only using provided sources.',
    '2) If not in sources, state not found and recommend escalation.',
    '3) Never provide clinical diagnosis or speculative advice.',
    '4) Keep answer concise and procedural.',
    '',
    `Client: ${clientName}`,
    `Question: ${question}`,
    '',
    'Sources:',
    contextText
  ].join('\n');

  const response = await client.chat.completions.create({
    model: env.openAiChatModel,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }]
  });

  const answer = response.choices?.[0]?.message?.content?.trim() || 'No answer generated. Escalate to supervisor.';
  return { answer, citations, grounded: true };
}

module.exports = { buildGroundedAnswer };
