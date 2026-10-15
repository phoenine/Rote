import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode, RefObject } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from './index';

const fixtures = vi.hoisted(() => ({
  patch: vi.fn(),
  load: vi.fn(),
  deleteAttachment: vi.fn(),
  upload: vi.fn(),
  crop: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  profile: { id: 'owner', username: 'owner', nickname: 'Owner', avatar: null },
  patchAtom: {},
}));
vi.mock('@/state/profile', () => ({
  profileAtom: {},
  patchProfileAtom: fixtures.patchAtom,
  loadProfileAtom: {},
  loadUserSettingsAtom: {},
}));
vi.mock('jotai', () => ({
  useAtomValue: () => fixtures.profile,
  useSetAtom: (atom: unknown) => (atom === fixtures.patchAtom ? fixtures.patch : fixtures.load),
}));
vi.mock('@/hooks/useSiteStatus', () => ({
  useSiteStatus: () => ({
    data: { storage: { r2Configured: true }, ui: { attachmentDirectBrowserUpload: true } },
  }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ capabilities: { 'attachment.upload': { allowed: true } } }),
}));
vi.mock('@/features/resources/useResourceState', () => ({
  isOfficialApiOrigin: () => false,
  useResourceState: () => ({}),
}));
vi.mock('@/utils/fetcher', () => ({ useAPIGet: () => ({}) }));
vi.mock('@/utils/api', () => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/utils/directUpload', () => ({ getUploadErrorMessage: (error: Error) => error.message }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { success: fixtures.success, error: fixtures.error } }));
vi.mock('./utils/avatarUpload', () => ({
  uploadAvatar: fixtures.upload,
  createCroppedImage: fixtures.crop,
  deletePendingProfileAttachment: fixtures.deleteAttachment,
  profileAttachmentUrl: (attachment: { url: string }) => attachment.url,
  uploadCover: vi.fn(),
}));
vi.mock('@/layout/ContainerWithSideBar', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/navBar', () => ({ default: () => null }));
vi.mock('@/components/others/EveDayOneCat', () => ({ default: () => null }));
vi.mock('./components/OpenKeySection', () => ({ default: () => null }));
vi.mock('./components/ProfileHeader', () => ({
  default: ({
    inputAvatarRef,
    onOpenEditProfile,
  }: {
    inputAvatarRef: RefObject<HTMLInputElement>;
    onOpenEditProfile: () => void;
  }) => (
    <>
      <button onClick={() => inputAvatarRef.current?.click()}>avatar</button>
      <button onClick={onOpenEditProfile}>edit</button>
    </>
  ),
}));
vi.mock('./components/EditProfileDialog', () => ({
  default: ({ isOpen, onSave }: { isOpen: boolean; onSave: () => void }) =>
    isOpen ? <button onClick={onSave}>save-profile</button> : null,
}));
vi.mock('./components/AvatarCropDialog', () => ({
  default: ({ isOpen, onSave }: { isOpen: boolean; onSave: (area: unknown) => void }) =>
    isOpen ? (
      <button onClick={() => onSave({ x: 0, y: 0, width: 64, height: 64 })}>crop-done</button>
    ) : null,
}));

function show() {
  const rendered = render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>
  );
  return {
    ...rendered,
    selectFile: () =>
      fireEvent.change(rendered.container.querySelector('input[type="file"]')!, {
        target: { files: [new File(['png'], 'avatar.png', { type: 'image/png' })] },
      }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.patch.mockResolvedValue(undefined);
  fixtures.crop.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  fixtures.upload.mockResolvedValue({ id: 'attachment', url: 'https://cos.example/avatar.png' });
  fixtures.deleteAttachment.mockResolvedValue(undefined);
});

describe('profile avatar upload persistence', () => {
  it('saves a directly uploaded PNG to the profile before reporting success', async () => {
    let finishSave: () => void = () => {};
    fixtures.patch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        })
    );
    const page = show();
    fireEvent.click(screen.getByText('avatar'));
    page.selectFile();
    fireEvent.click(screen.getByText('crop-done'));
    await waitFor(() =>
      expect(fixtures.patch).toHaveBeenCalledWith({
        avatar: 'https://cos.example/avatar.png',
        avatarAttachmentId: 'attachment',
      })
    );
    expect(fixtures.success).not.toHaveBeenCalled();
    await act(async () => finishSave());
    await waitFor(() => expect(fixtures.success).toHaveBeenCalledWith('uploadSuccess'));
    page.unmount();
    expect(fixtures.deleteAttachment).not.toHaveBeenCalled();
  });
  it('keeps editor uploads in the draft until the user saves the profile', async () => {
    const page = show();
    fireEvent.click(screen.getByText('edit'));
    page.selectFile();
    fireEvent.click(screen.getByText('crop-done'));
    await waitFor(() => expect(fixtures.success).toHaveBeenCalled());
    expect(fixtures.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('save-profile'));
    await waitFor(() =>
      expect(fixtures.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          avatar: 'https://cos.example/avatar.png',
          avatarAttachmentId: 'attachment',
        })
      )
    );
  });
  it('reports a profile-write failure rather than claiming upload success', async () => {
    fixtures.patch.mockRejectedValue(new Error('profile save failed'));
    const page = show();
    page.selectFile();
    fireEvent.click(screen.getByText('crop-done'));
    await waitFor(() =>
      expect(fixtures.error).toHaveBeenCalledWith('uploadFailed: profile save failed')
    );
    expect(fixtures.success).not.toHaveBeenCalled();
    expect(fixtures.deleteAttachment).toHaveBeenCalledWith('attachment');
  });
});
