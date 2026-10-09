import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AvatarCropDialog from './AvatarCropDialog';

const createUrl = vi.fn();
const revokeUrl = vi.fn();
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('react-easy-crop', () => ({
  default: ({
    image,
    onCropChange,
    onZoomChange,
  }: {
    image: string;
    onCropChange: (crop: { x: number; y: number }) => void;
    onZoomChange: (zoom: number) => void;
  }) => (
    <>
      <img src={image} alt="crop-preview" />
      <button onClick={() => onCropChange({ x: 12, y: 8 })}>move-crop</button>
      <button onClick={() => onZoomChange(2)}>zoom-crop</button>
    </>
  ),
}));

beforeEach(() => {
  createUrl.mockReset().mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two');
  revokeUrl.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
});
afterEach(() => vi.restoreAllMocks());

it('reuses the same local preview while moving and zooming, then releases it on close', () => {
  const props = {
    isOpen: true,
    imageFile: new File(['png'], 'avatar.png'),
    onSave: vi.fn(),
    onOpenChange: vi.fn(),
    isUploading: false,
  };
  const page = render(<AvatarCropDialog {...props} />);
  fireEvent.click(screen.getByText('move-crop'));
  fireEvent.click(screen.getByText('zoom-crop'));
  expect(screen.getByAltText('crop-preview')).toHaveAttribute('src', 'blob:one');
  expect(createUrl).toHaveBeenCalledTimes(1);
  page.rerender(<AvatarCropDialog {...props} isOpen={false} />);
  expect(revokeUrl).toHaveBeenCalledWith('blob:one');
});

it('releases the previous preview on file replacement and the final preview on unmount', () => {
  const props = {
    isOpen: true,
    imageFile: new File(['one'], 'one.png'),
    onSave: vi.fn(),
    onOpenChange: vi.fn(),
    isUploading: false,
  };
  const page = render(<AvatarCropDialog {...props} />);
  page.rerender(<AvatarCropDialog {...props} imageFile={new File(['two'], 'two.png')} />);
  expect(revokeUrl).toHaveBeenCalledWith('blob:one');
  expect(screen.getByAltText('crop-preview')).toHaveAttribute('src', 'blob:two');
  page.unmount();
  expect(revokeUrl).toHaveBeenCalledWith('blob:two');
});
