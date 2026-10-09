import { describe, expect, it } from 'bun:test';
import { parseMemoryOperations } from './extraction';
import { selectPersonaMemory } from '../postComments/memoryContext';

describe('automatic character memory boundaries', () => {
  it('requires verbatim author evidence and blocks invented role history', () => {
    const operation = {
      action: 'remember',
      scope: 'shared',
      key: 'reply-length',
      content: '喜欢短回复',
      evidence: '喜欢短回复',
      ttlDays: null,
    };
    expect(
      parseMemoryOperations(JSON.stringify({ operations: [operation] }), '我喜欢短回复', 'friend')
    ).toHaveLength(1);
    expect(() =>
      parseMemoryOperations(JSON.stringify({ operations: [operation] }), '今天很高兴', 'friend')
    ).toThrow('evidence');
    expect(() =>
      parseMemoryOperations(
        JSON.stringify({ operations: [{ ...operation, scope: 'persona' }] }),
        '喜欢短回复',
        'shared'
      )
    ).toThrow('relationship');
  });
  it('requires explicit forgetting, and clear-all is distinct from forgetting one fact', () => {
    const forget = { action: 'forget_all', scope: 'shared', evidence: '我喜欢短回复' };
    expect(() =>
      parseMemoryOperations(JSON.stringify({ operations: [forget] }), forget.evidence, 'friend')
    ).toThrow('explicit');
    forget.evidence = '忘掉这件事';
    expect(() =>
      parseMemoryOperations(JSON.stringify({ operations: [forget] }), forget.evidence, 'friend')
    ).toThrow('clear-all');
    forget.evidence = '忘掉所有记忆';
    expect(
      parseMemoryOperations(JSON.stringify({ operations: [forget] }), forget.evidence, 'friend')
    ).toHaveLength(1);
  });
  it('selects common plus own memories within one budget and suppresses forgotten historical sources', () => {
    const candidate = {
      kind: 'memory' as const,
      id: 'a',
      hash: 'h',
      date: '2026-10-09',
      text: '共同偏好',
      personaId: 'shared',
    };
    const memory = {
      message: '',
      sources: [],
      candidates: [
        candidate,
        { ...candidate, id: 'b', text: '小晴的诗', personaId: 'friend' },
        { ...candidate, id: 'c', text: '墨墨的讨论', personaId: 'reader' },
        { ...candidate, kind: 'rote' as const, id: 'old', text: '忘记的旧信息' },
      ],
      suppressions: [{ personaId: 'shared', sourceIds: ['rote:old'] }],
    };
    const selected = selectPersonaMemory(memory, 'friend');
    expect(selected.message).toContain('共同偏好');
    expect(selected.message).toContain('小晴的诗');
    expect(selected.message).not.toContain('墨墨');
    expect(selected.message).not.toContain('忘记');
    expect(Buffer.byteLength(selected.message)).toBeLessThanOrEqual(1000);
  });
});
