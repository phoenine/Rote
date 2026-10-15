import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useArticleImages } from './useArticleImages';

const upload = vi.hoisted(() => ({
  presign: vi.fn(),
  finalize: vi.fn(),
  put: vi.fn(),
  cancel: vi.fn(),
  compress: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/utils/uploadHelpers', () => ({ maybeCompressToWebp: upload.compress }));
vi.mock('sonner', () => ({ toast: { error: upload.error } }));
vi.mock('@/utils/directUpload', () => ({
  presignBrowserUpload: upload.presign,
  presign: vi.fn(),
  finalizeReservedUpload: upload.finalize,
  finalize: vi.fn(),
  uploadToSignedUrl: upload.put,
  cancelUploadReservation: upload.cancel,
  getUploadErrorMessage: () => 'upload rejected',
}));

function renderImages() {
  return renderHook(() => {
    const [content, setContent] = useState('before after');
    return { content, ...useArticleImages(setContent, true) };
  });
}

function cursor() {
  const textarea = document.createElement('textarea');
  textarea.value = 'before after';
  textarea.setSelectionRange(7, 7);
  return textarea;
}

describe('article image uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upload.compress.mockResolvedValue(null);
    upload.presign.mockResolvedValue({
      reservationId: 'reservation',
      items: [{ uuid: 'image', original: { key: 'key', putUrl: 'https://upload.invalid' } }],
    });
    upload.finalize.mockResolvedValue([
      {
        url: 'https://image.invalid/original.png',
        compressUrl: 'https://image.invalid/display.webp',
      },
    ]);
    upload.put.mockResolvedValue(undefined);
  });

  it('keeps uploads pending until database confirmation and inserts final URLs at the cursor', async () => {
    let finish: () => void = () => {};
    upload.put.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const { result } = renderImages();
    let running: Promise<void> = Promise.resolve();
    await act(async () => {
      running = result.current.uploadAndInsert(
        [new File(['image'], 'photo.png', { type: 'image/png' })],
        cursor()
      );
    });
    expect(result.current.uploading).toBe(true);
    expect(result.current.content).not.toBe('before after');
    expect(upload.finalize).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await running;
    });
    expect(result.current.uploading).toBe(false);
    expect(result.current.content).toBe(
      'before ![photo.png](https://image.invalid/display.webp)after'
    );
    expect(upload.finalize).toHaveBeenCalledWith(
      [expect.objectContaining({ size: 5, mimetype: 'image/png' })],
      'reservation'
    );
  });

  it('removes failed placeholders, cancels the reservation, and preserves surrounding text', async () => {
    upload.put.mockRejectedValueOnce(new Error('failed'));
    const { result } = renderImages();
    await act(async () => {
      await result.current.uploadAndInsert(
        [new File(['image'], 'photo.png', { type: 'image/png' })],
        cursor()
      );
    });
    expect(result.current.content).toBe('before after');
    expect(result.current.uploading).toBe(false);
    expect(upload.cancel).toHaveBeenCalledWith('reservation');
    expect(upload.finalize).not.toHaveBeenCalled();
    expect(upload.error).toHaveBeenCalled();
  });
});
