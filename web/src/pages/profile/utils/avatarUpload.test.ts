import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileAttachmentUrl, uploadAvatar } from './avatarUpload';

const uploads = vi.hoisted(() => ({
  compress: vi.fn(),
  presign: vi.fn(),
  finalize: vi.fn(),
  put: vi.fn(),
}));
vi.mock('@/utils/uploadHelpers', () => ({ maybeCompressToWebp: uploads.compress }));
vi.mock('@/utils/api', () => ({ del: vi.fn() }));
vi.mock('@/utils/directUpload', () => ({
  presignBrowserUpload: uploads.presign,
  finalizeReservedUpload: uploads.finalize,
  uploadToSignedUrl: uploads.put,
  cancelUploadReservation: vi.fn(),
  presign: vi.fn(),
  finalize: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  uploads.put.mockResolvedValue(undefined);
  uploads.presign.mockResolvedValue({
    reservationId: 'reservation',
    items: [
      {
        uuid: 'file',
        original: { key: 'uploads/file.png', putUrl: 'https://cos.example/original' },
        compressed: { key: 'compressed/file.webp', putUrl: 'https://cos.example/preview' },
      },
    ],
  });
});

describe('PNG avatar and optional WebP preview', () => {
  it('uses only the PNG when the browser produces no WebP preview', async () => {
    uploads.compress.mockResolvedValue(null);
    uploads.finalize.mockResolvedValue([
      { id: 'attachment', url: 'https://cos.example/file.png', compressUrl: null },
    ]);
    const result = await uploadAvatar(new Blob(['png'], { type: 'image/png' }), {
      browserDirectUpload: true,
    });
    expect(uploads.put).toHaveBeenCalledTimes(1);
    expect(uploads.presign.mock.calls[0][0][0]).not.toHaveProperty('compressed');
    expect(uploads.finalize.mock.calls[0][0][0].compressedKey).toBeUndefined();
    expect(profileAttachmentUrl(result)).toBe('https://cos.example/file.png');
  });
  it('declares a compressed URL only after its separate PUT succeeds', async () => {
    const preview = new Blob(['webp'], { type: 'image/webp' });
    uploads.compress.mockResolvedValue(preview);
    uploads.finalize.mockResolvedValue([
      {
        id: 'attachment',
        url: 'https://cos.example/file.png',
        compressUrl: 'https://cos.example/file.webp',
      },
    ]);
    const result = await uploadAvatar(new Blob(['png'], { type: 'image/png' }), {
      browserDirectUpload: true,
    });
    expect(uploads.put).toHaveBeenCalledTimes(2);
    expect(uploads.put).toHaveBeenNthCalledWith(2, 'https://cos.example/preview', preview);
    expect(uploads.finalize.mock.calls[0][0][0].compressedKey).toBe('compressed/file.webp');
    expect(profileAttachmentUrl(result)).toBe('https://cos.example/file.webp');
  });
  it('does not confirm or report success if a declared WebP upload fails', async () => {
    uploads.compress.mockResolvedValue(new Blob(['webp'], { type: 'image/webp' }));
    uploads.put
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('preview PUT failed'));
    await expect(uploadAvatar(new Blob(['png']), { browserDirectUpload: true })).rejects.toThrow(
      'preview PUT failed'
    );
    expect(uploads.finalize).not.toHaveBeenCalled();
  });
});
