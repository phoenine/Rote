export type VoiceSample = { personaId: string; reply: string };

/** Descriptive signals for reviewing real outputs, not an automatic personality grade. */
export function summarizeVoice(samples: VoiceSample[]) {
  return Object.fromEntries(
    [...new Set(samples.map((sample) => sample.personaId))].map((id) => {
      const replies = samples
        .filter((sample) => sample.personaId === id)
        .map((sample) => sample.reply);
      const lengths = replies.map((reply) => Array.from(reply.replace(/\s/gu, '')).length);
      const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
      const emoji = new RegExp('\\p{Extended_Pictographic}', 'u');
      return [
        id,
        {
          samples: replies.length,
          minCharacters: Math.min(...lengths),
          maxCharacters: Math.max(...lengths),
          meanCharacters: Math.round(mean * 10) / 10,
          lengthStdDev:
            Math.round(
              Math.sqrt(
                lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) / lengths.length
              ) * 10
            ) / 10,
          repliesWithEmoji: replies.filter((reply) => emoji.test(reply)).length,
          repliesWithLineBreaks: replies.filter((reply) => reply.trim().includes('\n')).length,
        },
      ];
    })
  );
}
