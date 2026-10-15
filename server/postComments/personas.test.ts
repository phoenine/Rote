import { describe, expect, it } from 'bun:test';
import { choosePersona, personas, replySystemPrompt, type PersonaId } from './personas';

describe('reply character selection and prompt assembly', () => {
  const ids: PersonaId[] = ['neighbor', 'traveler', 'friend', 'reader'];

  it('preserves stored identities and excludes characters already in a post', () => {
    expect(Object.keys(personas).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(choosePersona(ids.filter((other) => other !== id))).toBe(id);
    }
  });

  it.each(ids)('supplies only %s character traits and voice examples', (id) => {
    const prompt = replySystemPrompt(id);
    const profile = personas[id];
    for (const text of [
      profile.name,
      profile.background,
      profile.temperament,
      profile.attention,
      profile.responseStyle,
      profile.avoid,
    ]) {
      expect(prompt).toContain(text);
    }
    for (const example of profile.examples) {
      expect(prompt).toContain(`Author: ${example.author}\nYou: ${example.reply}`);
    }
    for (const other of ids.filter((other) => other !== id)) {
      expect(prompt).not.toContain(personas[other].name);
      expect(prompt).not.toContain(personas[other].temperament);
      for (const example of personas[other].examples) {
        expect(prompt).not.toContain(example.reply);
      }
    }
  });

  it('rejects unknown identities instead of assembling an undefined character', () => {
    for (const id of ['unknown', '', 'toString', '__proto__', 'constructor']) {
      expect(() => replySystemPrompt(id)).toThrow('Unknown reply persona');
    }
  });
});
