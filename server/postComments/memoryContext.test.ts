import { describe, expect, it } from 'bun:test';
import { packReplyMemory, truncateUtf8, REPLY_MEMORY_BYTE_BUDGET } from './memoryContext';

describe('reply memory budget', () => {
  it('caps three records including labels and instructions without splitting Unicode', () => {
    const memory = packReplyMemory(
      Array.from({ length: 5 }, (_, index) => ({
        kind: 'rote' as const,
        id: String(index),
        hash: 'version',
        date: '2026-10-09',
        text: '中文🙂'.repeat(500),
      }))
    );
    expect(memory.sources.map((source) => source.id)).toEqual(['0', '1', '2']);
    expect(Buffer.byteLength(memory.message)).toBeLessThanOrEqual(REPLY_MEMORY_BYTE_BUDGET);
    expect(memory.message).not.toContain('\uFFFD');
    expect(truncateUtf8('🙂好', 5)).toBe('🙂');
    expect(packReplyMemory([])).toEqual({ message: '', sources: [] });
  });
});
