import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { maybeCompressToWebp } from '@/utils/uploadHelpers';
import {
  finalize,
  cancelUploadReservation,
  finalizeReservedUpload,
  getUploadErrorMessage,
  presign,
  presignBrowserUpload,
  uploadToSignedUrl,
} from '@/utils/directUpload';

export function useArticleImages(
  setContent: Dispatch<SetStateAction<string>>,
  supportsBrowserDirectUpload: boolean
) {
  const { t } = useTranslation('translation', { keyPrefix: 'article.editor' });
  const [uploading, setUploading] = useState(false);
  const pending = useRef(0);
  const uploadAndInsert = async (files: FileList | File[], textarea: HTMLTextAreaElement) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    pending.current += fileArray.length;
    setUploading(true);
    const uploads = fileArray.map((file) => {
      const id = crypto.randomUUID();
      const placeholder = `![${t('uploadingPlaceholder', { name: file.name })}](${id})`;
      return { file, id, placeholder };
    });

    const placeholdersText = uploads.map((u) => u.placeholder).join('\n');
    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;

    setContent((prev) => {
      const pre = prev.substring(0, startPos);
      const suf = prev.substring(endPos);
      return pre + placeholdersText + suf;
    });

    for (const { file, placeholder } of uploads) {
      let activeReservationId: string | null = null;
      try {
        const compressed = await maybeCompressToWebp(file);
        const presignFiles = [
          {
            filename: file.name,
            contentType: file.type,
            size: file.size,
            ...(compressed && supportsBrowserDirectUpload
              ? {
                  compressed: {
                    contentType: compressed.type as 'image/jpeg' | 'image/webp',
                    size: compressed.size,
                  },
                }
              : {}),
          },
        ];
        const directPresign = supportsBrowserDirectUpload
          ? await presignBrowserUpload(presignFiles)
          : null;
        activeReservationId = directPresign?.reservationId ?? null;
        const item = directPresign ? directPresign.items[0] : (await presign(presignFiles))[0];

        await uploadToSignedUrl(item.original.putUrl, file);
        if (compressed && item.compressed) {
          await uploadToSignedUrl(item.compressed.putUrl, compressed);
        }

        const finalizePayload = {
          uuid: item.uuid,
          originalKey: item.original.key,
          compressedKey: compressed && item.compressed ? item.compressed.key : undefined,
          size: file.size,
          mimetype: file.type,
        };

        const [finalized] = directPresign
          ? await finalizeReservedUpload([finalizePayload], directPresign.reservationId)
          : await finalize([finalizePayload]);
        activeReservationId = null;
        const finalUrl = finalized.compressUrl || finalized.url;
        const finalMarkdown = `![${file.name}](${finalUrl})`;

        setContent((prev) => prev.replace(placeholder, finalMarkdown));
      } catch (_err) {
        if (activeReservationId) {
          try {
            await cancelUploadReservation(activeReservationId);
          } catch (cancellationError) {
            // eslint-disable-next-line no-console
            console.error('Failed to cancel article upload reservation:', cancellationError);
          }
        }
        toast.error(`${t('uploadFailed', { name: file.name })}: ${getUploadErrorMessage(_err)}`);
        setContent((prev) => prev.replace(placeholder, ''));
      } finally {
        pending.current -= 1;
        if (pending.current === 0) setUploading(false);
      }
    }
  };

  return { uploading, uploadAndInsert };
}
