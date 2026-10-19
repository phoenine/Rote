import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import cases from '../postComments/personaEvalCases.json';
import { summarizeVoice } from '../postComments/personaEvaluation';
import {
  chooseReplyDelivery,
  personas,
  replyPromptMessages,
  replySystemPrompt,
  type PersonaId,
  type ReplyDelivery,
} from '../postComments/personas';
import type { ChatMessage } from '../utils/ai/client';

async function main() {
  // Explicit opt-in provider; never read the site's database, memories, or credentials.
  const baseUrl = process.env.ROTE_PERSONA_EVAL_BASE_URL?.replace(/\/+$/, '');
  const model = process.env.ROTE_PERSONA_EVAL_MODEL;
  const output = process.env.ROTE_PERSONA_EVAL_OUTPUT;
  if (!baseUrl || !model || !output) {
    throw new Error(
      'Set ROTE_PERSONA_EVAL_BASE_URL, ROTE_PERSONA_EVAL_MODEL, and ROTE_PERSONA_EVAL_OUTPUT'
    );
  }
  const requested = process.env.ROTE_PERSONA_EVAL_CASES?.split(',');
  const selected = requested ? cases.filter((item) => requested.includes(item.id)) : cases;
  if (!selected.length || requested?.some((id) => !cases.some((item) => item.id === id))) {
    throw new Error('Unknown or empty evaluation case selection');
  }
  const rounds = Number(process.env.ROTE_PERSONA_EVAL_ROUNDS || 1);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
    throw new Error('Evaluation rounds must be an integer between 1 and 10');
  }
  const snapshotPath = process.env.ROTE_PERSONA_EVAL_PROMPTS;
  const prompts: Record<string, string | ChatMessage[]> = snapshotPath
    ? JSON.parse(await readFile(snapshotPath, 'utf8'))
    : Object.fromEntries(Object.keys(personas).map((id) => [id, replySystemPrompt(id)]));
  for (const id of Object.keys(personas)) {
    if (
      !(typeof prompts[id] === 'string'
        ? prompts[id].trim()
        : Array.isArray(prompts[id]) && prompts[id].length)
    ) {
      throw new Error(`Missing evaluation prompt for ${id}`);
    }
  }
  const disableThinking = process.env.ROTE_PERSONA_EVAL_DISABLE_THINKING === '1';
  const maxTokens = Number(process.env.ROTE_PERSONA_EVAL_MAX_TOKENS || 1024);
  if (!Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > 8192) {
    throw new Error('Evaluation max tokens must be an integer between 64 and 8192');
  }
  const samples: {
    personaId: string;
    caseId: string;
    round: number;
    turn: number;
    input: string;
    reply: string;
    promptHash: string;
    delivery?: ReplyDelivery;
  }[] = [];
  const metadata = {
    model,
    providerOrigin: new URL(baseUrl).origin,
    temperature: 0.8,
    maxTokens,
    disableThinking,
    startedAt: new Date().toISOString(),
    promptHashes: Object.fromEntries(
      Object.entries(prompts).map(([id, prompt]) => [
        id,
        createHash('sha256')
          .update(typeof prompt === 'string' ? prompt : JSON.stringify(prompt))
          .digest('hex'),
      ])
    ),
    cases: selected,
    rounds,
  };
  async function save(complete: boolean) {
    await writeFile(
      output!,
      JSON.stringify(
        { ...metadata, complete, samples, summary: summarizeVoice(samples) },
        null,
        2
      ) + '\n'
    );
  }
  await save(false);
  for (let round = 1; round <= rounds; round++) {
    for (const scenario of selected) {
      for (const personaId of Object.keys(personas)) {
        const prompt = prompts[personaId];
        const messages: ChatMessage[] = [];
        for (const [turn, input] of scenario.messages.entries()) {
          messages.push({ role: 'user', content: input });
          const delivery = snapshotPath ? undefined : chooseReplyDelivery(personaId as PersonaId);
          const prefix: ChatMessage[] = snapshotPath
            ? typeof prompt === 'string'
              ? [{ role: 'system', content: prompt }]
              : prompt
            : replyPromptMessages(personaId, delivery);
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(process.env.ROTE_PERSONA_EVAL_API_KEY
                ? { Authorization: `Bearer ${process.env.ROTE_PERSONA_EVAL_API_KEY}` }
                : {}),
            },
            body: JSON.stringify({
              model,
              messages: [...prefix, ...messages],
              temperature: metadata.temperature,
              max_tokens: maxTokens,
              ...(disableThinking
                ? { reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false } }
                : {}),
            }),
            signal: AbortSignal.timeout(90000),
          });
          if (!response.ok) throw new Error(`Evaluation provider returned HTTP ${response.status}`);
          const data = await response.json();
          const choice = data.choices?.[0];
          const reply = choice?.message?.content?.trim();
          if (typeof reply !== 'string' || !reply || choice.finish_reason === 'length') {
            throw new Error(
              `Empty or truncated evaluation reply: ${personaId}/${scenario.id}/${turn}`
            );
          }
          samples.push({
            personaId,
            caseId: scenario.id,
            round,
            turn,
            input,
            reply,
            promptHash: createHash('sha256').update(JSON.stringify(prefix)).digest('hex'),
            delivery,
          });
          messages.push({ role: 'assistant', content: reply });
          await save(false);
          console.log(
            `${round}/${scenario.id}/${personaId}/${turn}: ${reply.replace(/\n/g, ' / ')}`
          );
        }
      }
    }
  }
  await save(true);
  console.log(JSON.stringify(summarizeVoice(samples), null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
