import type { Attachment } from '@/types/main';
import { describe, expect, it } from 'vitest';
import { emptyRote, sanitizeStoredEditorDraft } from '../editor';

const uploadedAttachment: Attachment = {
  id: 'attachment-1',
  url: 'https://example.test/users/1/uploads/a.jpg',
  compressUrl: '',
  userid: 'user-1',
  roteid: null,
  sortIndex: 0,
  storage: 'R2',
  details: { key: 'users/1/uploads/a.jpg' },
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
};

describe('sanitizeStoredEditorDraft', () => {
  it('keeps uploaded attachments but omits browser Files and stale JSON placeholders', () => {
    const localFile = new File(['draft'], 'draft.jpg', { type: 'image/jpeg' });
    const draft = {
      ...emptyRote,
      attachments: [uploadedAttachment, localFile, {} as Attachment],
    };

    expect(sanitizeStoredEditorDraft(draft).attachments).toEqual([uploadedAttachment]);
    expect(draft.attachments).toHaveLength(3);
  });

  it('repairs a legacy draft without a valid attachments array', () => {
    const legacyDraft = { ...emptyRote, attachments: null } as unknown as typeof emptyRote;

    expect(sanitizeStoredEditorDraft(legacyDraft).attachments).toEqual([]);
  });

  it('restores legacy home drafts as new notes while preserving their content', () => {
    const draft = {
      ...emptyRote,
      id: 'stale-note-id',
      content: 'unsent text',
      tags: ['draft'],
      articleId: 'article-id',
      attachments: [uploadedAttachment],
    };

    expect(sanitizeStoredEditorDraft(draft)).toEqual({
      ...draft,
      id: '',
      createId: undefined,
    });
    expect(draft.id).toBe('stale-note-id');
  });

  it('clears mismatched identities instead of updating an unrelated note', () => {
    const draft = { ...emptyRote, id: 'stale-note-id', createId: 'create-id' };

    expect(sanitizeStoredEditorDraft(draft)).toMatchObject({ id: '', createId: undefined });
  });

  it('preserves the saved identity for a resumed submission', () => {
    const draft = { ...emptyRote, id: 'create-id', createId: 'create-id' };

    expect(sanitizeStoredEditorDraft(draft)).toEqual(draft);
  });

  it('preserves the idempotency key when the create response was lost', () => {
    const draft = { ...emptyRote, createId: 'create-id' };

    expect(sanitizeStoredEditorDraft(draft)).toEqual(draft);
  });
});
