import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Area } from 'react-easy-crop';
import Cropper from 'react-easy-crop';
import { useTranslation } from 'react-i18next';

interface AvatarCropDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  imageFile: File | null;
  onSave: (croppedAreaPixels: Area) => Promise<void>;
  isUploading: boolean;
}

export default function AvatarCropDialog({
  isOpen,
  onOpenChange,
  imageFile,
  onSave,
  isUploading,
}: AvatarCropDialogProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.profile' });
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!isOpen || !imageFile) return;
    const url = URL.createObjectURL(imageFile);
    setPreview({ file: imageFile, url });
    return () => URL.revokeObjectURL(url);
  }, [imageFile, isOpen]);

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: any, croppedAreaPixelsData: Area) => {
    setCroppedAreaPixels(croppedAreaPixelsData);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) {
      return;
    }
    await onSave(croppedAreaPixels);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('cropAvatar')}</DialogTitle>
        </DialogHeader>
        <div className="relative h-[300px] w-full">
          {preview?.file === imageFile && preview && (
            <Cropper
              image={preview.url}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
            />
          )}
        </div>
        <Button className={`mt-4 w-full`} onClick={handleSave} disabled={isUploading}>
          {isUploading && <Loader className="mr-2 size-4 animate-spin" />}
          {isUploading ? t('uploading') : t('done')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
