import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostComments } from './PostComments';

const api = vi.hoisted(() => ({ list: vi.fn(), generate: vi.fn(), remove: vi.fn() }));
vi.mock('./api', () => ({
  listPostComments: api.list,
  generatePostComment: api.generate,
  deletePostComment: api.remove,
  postCommentErrorKey: () => 'errors.failed',
}));
vi.mock('jotai', () => ({ useAtomValue: () => ({ id: 'owner' }), atom: vi.fn() }));
vi.mock('@/state/profile', () => ({ profileAtom: {} }));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ capabilities: { 'ai.chat': { allowed: true } } }),
}));

function show(owner = true) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PostComments kind="article" id="article" owner={owner} />
    </SWRConfig>
  );
}

describe('private post comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue([]);
  });

  it('does not fetch or render comments for other viewers', () => {
    const { container } = show(false);
    expect(container).toBeEmptyDOMElement();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('disables repeated generation until the request completes', async () => {
    let finish: () => void = () => {};
    api.generate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    show();
    await screen.findByText('empty');
    fireEvent.click(screen.getByRole('button', { name: 'generate' }));
    expect(screen.getByRole('button', { name: 'generating' })).toBeDisabled();
    expect(api.generate).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'generate' })).toBeEnabled());
  });

  it('labels stale results and lets an owner delete failed requests', async () => {
    api.list.mockResolvedValue([
      { id: 'comment', status: 'failed', stale: true, content: '', model: 'test' },
    ]);
    api.remove.mockResolvedValue(undefined);
    show();
    await screen.findByText('stale');
    expect(screen.getByText('failed')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('article', 'article', 'comment'));
  });
});
