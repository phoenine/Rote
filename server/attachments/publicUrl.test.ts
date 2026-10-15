import { describe, expect, test } from 'bun:test';
import { normalizeStorageUrlPrefix } from './publicUrl';
import { toUploadResult } from './finalizePayload';

describe('public storage URLs', () => {
  test('preserves absolute CDN paths and trims trailing slashes', () => {
    expect(normalizeStorageUrlPrefix(' https://cdn.example.com/media/// ')).toBe(
      'https://cdn.example.com/media'
    );
  });

  test('rejects relative hosts and non-public URL components', () => {
    for (const prefix of [
      'bucket.cos.ap-nanjing.myqcloud.com',
      '//cdn.example.com',
      '/media',
      'https:cdn.example.com',
      'ftp://cdn.example.com',
      'https://user:password@cdn.example.com',
      'https://cdn.example.com?signature=abc',
      'https://cdn.example.com#image',
    ]) {
      expect(() => normalizeStorageUrlPrefix(prefix)).toThrow();
    }
  });

  test('builds original and preview URLs from the same validated prefix', () => {
    const result = toUploadResult('https://cdn.example.com/', {
      uuid: 'photo',
      originalKey: 'users/u/uploads/photo.png',
      compressedKey: 'users/u/compressed/photo.webp',
      mimetype: 'image/png',
      size: 123,
    });
    expect(result.url).toBe('https://cdn.example.com/users/u/uploads/photo.png');
    expect(result.compressUrl).toBe('https://cdn.example.com/users/u/compressed/photo.webp');
    expect(() =>
      toUploadResult('cdn.example.com', {
        uuid: 'photo',
        originalKey: 'users/u/uploads/photo.png',
      })
    ).toThrow();
  });
});
