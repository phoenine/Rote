import { describe, expect, it } from 'bun:test';
import {
  choosePersona,
  chooseReplyDelivery,
  personas,
  replySystemPrompt,
  replyPromptMessages,
  type PersonaId,
} from './personas';

describe('reply character selection and prompt assembly', () => {
  const ids: PersonaId[] = ['neighbor', 'traveler', 'friend', 'reader'];

  it('preserves stored identities and excludes characters already in a post', () => {
    expect(Object.keys(personas).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(choosePersona(ids.filter((other) => other !== id))).toBe(id);
    }
  });

  it.each(ids)('supplies only %s character traits and voice examples', (id) => {
    const messages = replyPromptMessages(id, { rhythm: 'chat', emoji: 'plain' });
    const prompt = messages.map((message) => message.content).join('\n');
    expect(messages[0].content).toStartWith(replySystemPrompt(id));
    expect(messages.filter((message) => message.role === 'system')).toHaveLength(1);
    const profile = personas[id];
    for (const text of [
      profile.name,
      profile.dailyTexture,
      profile.region,
      profile.conversationalDrive,
      profile.intimacy,
      profile.professionalHabits,
      profile.temperament,
      profile.attention,
      profile.responseStyle,
      profile.rhythm,
      profile.emoji,
      profile.avoid,
    ]) {
      expect(prompt).toContain(text);
    }
    for (const example of profile.examples) {
      expect(prompt).toContain(`作者：${example.author}\n你：${example.reply}`);
    }
    for (const other of ids.filter((other) => other !== id)) {
      expect(prompt).not.toContain(personas[other].name);
      expect(prompt).not.toContain(personas[other].temperament);
      expect(prompt).not.toContain(personas[other].professionalHabits);
      expect(prompt).not.toContain(personas[other].rhythm);
      expect(prompt).not.toContain(personas[other].emoji);
      for (const example of personas[other].examples) {
        expect(prompt).not.toContain(example.reply);
      }
    }
  });

  it.each(ids)('%s examples demonstrate multiple lengths and expressive habits', (id) => {
    const replies = personas[id].examples.map((example) => example.reply);
    const lengths = replies.map((reply) => Array.from(reply.replace(/\s/gu, '')).length);
    const emoji = new RegExp('\\p{Extended_Pictographic}', 'u');
    expect(Math.min(...lengths)).toBeLessThanOrEqual(10);
    // Corpus diversity only, never a length quota on generated replies.
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeGreaterThanOrEqual(4);
    expect(replies.some((reply) => emoji.test(reply))).toBe(true);
    expect(replies.some((reply) => !emoji.test(reply))).toBe(true);
    expect(replies.some((reply) => reply.includes('\n'))).toBe(true);
  });

  it('can vary expression without injecting demonstrations as author history', () => {
    const reaction = replyPromptMessages('friend', { rhythm: 'reaction', emoji: 'plain' });
    const expanded = replyPromptMessages('friend', { rhythm: 'expanded', emoji: 'expressive' });
    expect(reaction).toHaveLength(1);
    expect(expanded).toHaveLength(1);
    expect(reaction[0].role).toBe('system');
    expect(reaction[0].content).not.toBe(expanded[0].content);
    expect(reaction[0].content).toContain('明确认真求助');
    expect(expanded[0].content).toContain('严肃痛苦');
  });

  it('keeps authored delivery pools within the supported generation modes', () => {
    for (const profile of Object.values(personas)) {
      expect(profile.delivery.rhythms.length).toBeGreaterThan(0);
      expect(profile.delivery.moves.length).toBeGreaterThan(0);
      expect(
        profile.delivery.rhythms.every((mode) => ['reaction', 'chat', 'expanded'].includes(mode))
      ).toBe(true);
      expect(profile.delivery.emoji).toContain('plain');
      expect(profile.delivery.emoji).toContain('expressive');
      expect(profile.delivery.emoji.every((mode) => ['plain', 'expressive'].includes(mode))).toBe(
        true
      );
    }
  });

  it('samples conversational intent from the selected character only', () => {
    for (const id of ids) {
      for (let sample = 0; sample < 12; sample++) {
        const delivery = chooseReplyDelivery(id);
        expect(personas[id].delivery.moves).toContain(delivery.move!);
        expect(replyPromptMessages(id, delivery)[0].content).toContain(delivery.move!);
      }
    }
  });

  it('rejects unknown identities instead of assembling an undefined character', () => {
    for (const id of ['unknown', '', 'toString', '__proto__', 'constructor']) {
      expect(() => replySystemPrompt(id)).toThrow('Unknown reply persona');
    }
  });
});
