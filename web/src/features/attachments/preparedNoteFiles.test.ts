import { beforeEach, describe, expect, it, vi } from 'vitest';
import imageCompression from 'browser-image-compression';
import { noteFileManifest, prepareNoteFiles } from './preparedNoteFiles';

vi.mock('browser-image-compression', () => ({ default: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe('prepared image upload metadata', () => {
  it('omits the preview when the browser returns PNG instead of requested WebP', async () => {
    const original = new File(['original'], 'photo.png', { type: 'image/png' });
    vi.mocked(imageCompression).mockResolvedValue(
      new File(['preview'], 'photo.png', { type: 'image/png' })
    );

    const [prepared] = await prepareNoteFiles([original]);

    expect(prepared.file).toBe(original);
    expect(prepared.compressed).toBeNull();
    expect(noteFileManifest(prepared)).toEqual({
      filename: 'photo.png',
      contentType: 'image/png',
      size: original.size,
    });
  });

  it('declares the same WebP type and size as the actual preview', async () => {
    const original = new File(['original'], 'photo.png', { type: 'image/png' });
    const preview = new File(['preview'], 'photo.webp', { type: 'image/webp' });
    vi.mocked(imageCompression).mockResolvedValue(preview);

    const [prepared] = await prepareNoteFiles([original]);

    expect(prepared.compressed).toBe(preview);
    expect(noteFileManifest(prepared).compressed).toEqual({
      contentType: preview.type,
      size: preview.size,
    });
  });

  it('keeps compression errors visible to the submission flow', async () => {
    vi.mocked(imageCompression).mockRejectedValue(new Error('encoding failed'));

    await expect(
      prepareNoteFiles([new File(['original'], 'photo.png', { type: 'image/png' })])
    ).rejects.toThrow('encoding failed');
  });
});
