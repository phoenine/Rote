import { describe, expect, it } from 'bun:test';
import { summarizeVoice } from './personaEvaluation';

describe('real voice output measurements', () => {
  it('reports observed length spread and expression without treating either as a grade', () => {
    const result = summarizeVoice([
      { personaId: 'a', reply: '好' },
      { personaId: 'b', reply: 'hello' },
      { personaId: 'a', reply: '好呀\n🫶' },
    ]);
    expect(result.a).toEqual({
      samples: 2,
      minCharacters: 1,
      maxCharacters: 3,
      meanCharacters: 2,
      lengthStdDev: 1,
      repliesWithEmoji: 1,
      repliesWithLineBreaks: 1,
    });
    expect(result.b.minCharacters).toBe(5);
    expect(result.b.lengthStdDev).toBe(0);
    expect(result.b.repliesWithEmoji).toBe(0);
  });

  it('does not produce fake results for an empty or interrupted evaluation', () => {
    expect(summarizeVoice([])).toEqual({});
  });
});
