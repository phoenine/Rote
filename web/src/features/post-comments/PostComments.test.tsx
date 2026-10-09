import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostComments } from './PostComments';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  generate: vi.fn(),
  remove: vi.fn(),
  reply: vi.fn(),
}));
vi.mock('./api', () => ({
  listPostComments: api.list,
  generatePostComment: api.generate,
  deletePostComment: api.remove,
  replyToThread: api.reply,
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

describe('post reply conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue([]);
  });

  it('loads public replies without owner controls', async () => {
    api.list.mockResolvedValue([
      {
        id: 'public',
        personaId: 'neighbor',
        legacy: false,
        content: 'Hello',
        status: 'completed',
        turns: [],
      },
    ]);
    show(false);
    await screen.findByText('Hello');
    expect(api.list).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'invite' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('aiLabel')).not.toBeInTheDocument();
  });

  it('limits invitations to three roles', async () => {
    api.list.mockResolvedValue(
      ['neighbor', 'friend', 'reader'].map((personaId) => ({
        id: personaId,
        personaId,
        legacy: false,
        content: personaId,
        status: 'completed',
        turns: [],
      }))
    );
    show();
    await screen.findByText('neighbor');
    expect(screen.getByRole('button', { name: 'invite' })).toBeDisabled();
  });

  it('tells the owner which conversations remain private after publishing', async () => {
    api.list.mockResolvedValue([
      {
        id: 'private',
        personaId: 'friend',
        legacy: false,
        publicSafe: false,
        content: 'Private exchange',
        status: 'completed',
        turns: [],
      },
    ]);
    show();
    await screen.findByText('Private exchange');
    expect(screen.getByText('privateContext')).toBeInTheDocument();
  });

  it('sends a comment to the same role', async () => {
    api.list.mockResolvedValue([
      {
        id: 'thread',
        personaId: 'friend',
        legacy: false,
        content: 'Hello',
        status: 'completed',
        turns: [],
      },
    ]);
    api.reply.mockResolvedValue({ status: 'completed' });
    show();
    await screen.findByText('Hello');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'How are you?' } });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() =>
      expect(api.reply).toHaveBeenCalledWith(
        'article',
        'article',
        'thread',
        'How are you?',
        expect.any(String),
        true
      )
    );
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });

  it('uses a single composer and sends its preserved draft to the selected role', async () => {
    api.list.mockResolvedValue(
      ['neighbor', 'friend', 'reader'].map((personaId) => ({
        id: personaId,
        personaId,
        legacy: false,
        content: personaId,
        status: 'completed',
        turns: [],
      }))
    );
    api.reply.mockResolvedValue({ status: 'completed' });
    show();
    await screen.findByText('neighbor');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A shared draft' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'replyTo' })[1]);
    expect(screen.getByRole('textbox')).toHaveValue('A shared draft');
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() =>
      expect(api.reply).toHaveBeenCalledWith(
        'article',
        'article',
        'friend',
        'A shared draft',
        expect.any(String),
        true
      )
    );
  });

  it('expands and collapses replies without adding another composer', async () => {
    api.list.mockResolvedValue([
      {
        id: 'thread',
        personaId: 'friend',
        legacy: false,
        content: 'First reply',
        status: 'completed',
        turns: [
          {
            id: 'turn',
            userContent: 'My comment',
            replyContent: 'A continued reply',
            status: 'completed',
          },
        ],
      },
    ]);
    show();
    await screen.findByText('First reply');
    expect(screen.queryByText('My comment')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'expandReplies' }));
    expect(screen.getByText('My comment')).toBeVisible();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'collapseReplies' }));
    expect(screen.queryByText('My comment')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'invite' }));
    expect(screen.getByRole('button', { name: 'generating' })).toBeDisabled();
    expect(api.generate).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'invite' })).toBeEnabled());
  });

  it('labels stale results and lets an owner delete failed requests', async () => {
    api.list.mockResolvedValue([
      { id: 'comment', status: 'failed', stale: true, content: '', model: 'test' },
    ]);
    api.remove.mockResolvedValue(undefined);
    show();
    await screen.findByText('stale');
    expect(screen.getByText('failed')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'deleteRole' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('article', 'article', 'comment'));
  });
});
