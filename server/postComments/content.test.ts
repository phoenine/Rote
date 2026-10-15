import { describe, expect, it } from 'bun:test';
import { commentMatchesTarget, postContentHash, requireCommentableText } from './content';

describe('post comment input boundaries', () => {
  it('allows conversation on image-only posts without requiring recognition', () => {
    expect(() =>
      requireCommentableText('  ![photo](https://example.com/photo.jpg)  ')
    ).not.toThrow();
    expect(() => requireCommentableText('')).not.toThrow();
    expect(() =>
      requireCommentableText('A useful observation\n![photo](https://example.com/photo.jpg)')
    ).not.toThrow();
  });

  it('bounds model input without silently truncating it', () => {
    expect(() => requireCommentableText('a'.repeat(20000))).not.toThrow();
    expect(() => requireCommentableText('a'.repeat(20001))).toThrow(
      'post_comment_content_too_long'
    );
  });

  it('distinguishes text versions and target kinds for idempotency', () => {
    expect(postContentHash('version 1')).not.toBe(postContentHash('version 2'));
    expect(postContentHash('version 1')).toBe(postContentHash('version 1'));
    const comment = { roteId: 'same-id', articleId: null };
    expect(commentMatchesTarget(comment, 'rote', 'same-id')).toBe(true);
    expect(commentMatchesTarget(comment, 'article', 'same-id')).toBe(false);
    expect(commentMatchesTarget(comment, 'rote', 'other-id')).toBe(false);
  });
});
