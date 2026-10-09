import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostCommentsPreview } from './PostCommentsPreview';

const list = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ listPostComments: list }));
vi.mock('jotai', () => ({ useAtomValue: () => ({ id: 'owner' }), atom: vi.fn() }));
vi.mock('@/state/profile', () => ({ profileAtom: {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count ? `Comments ${options.count}` : key,
  }),
}));

function show(active = true) {
  return render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PostCommentsPreview postId="post" active={active} createdAt="2026-01-01" />
      </SWRConfig>
    </MemoryRouter>
  );
}

describe('post comment entry in the feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('links to the post and counts dialogue messages rather than characters', async () => {
    list.mockResolvedValue([
      {
        id: 'thread',
        personaId: 'neighbor',
        content: 'First reply',
        status: 'completed',
        turns: [
          { status: 'completed', userContent: 'Hello', replyContent: 'Welcome back' },
          { status: 'failed', userContent: 'Please keep this comment', replyContent: '' },
        ],
      },
    ]);
    show();
    await screen.findByText('Welcome back');
    expect(screen.getByRole('link', { name: 'Comments 4' })).toHaveAttribute('href', '/rote/post');
    expect(screen.queryByText('First reply')).not.toBeInTheDocument();
  });

  it('keeps an accessible detail link without fetching off-screen posts', () => {
    show(false);
    expect(screen.getByRole('link', { name: 'viewComments' })).toHaveAttribute(
      'href',
      '/rote/post'
    );
    expect(list).not.toHaveBeenCalled();
  });
});
