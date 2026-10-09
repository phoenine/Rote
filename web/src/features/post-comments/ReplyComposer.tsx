import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import UserAvatar from '@/components/others/UserAvatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  name?: string;
  avatar?: string | null;
  content: string;
  sending: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  focusKey: string | null;
};

export function ReplyComposer({
  name,
  avatar,
  content,
  sending,
  disabled,
  onChange,
  onSend,
  focusKey,
}: Props) {
  const { t } = useTranslation('translation', { keyPrefix: 'components.postComments' });
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusKey) input.current?.focus({ preventScroll: true });
  }, [focusKey]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !sending && content.trim()) onSend();
      }}
      className="bg-background/95 sticky bottom-16 z-20 -mx-4 mt-3 border-t px-4 py-3 backdrop-blur md:bottom-0"
    >
      {name && (
        <p className="text-muted-foreground mb-2 pl-11 text-xs">{t('replyTarget', { name })}</p>
      )}
      <div className="flex items-end gap-2">
        <UserAvatar avatar={avatar} className="mb-1 size-9 shrink-0 rounded-md" />
        <Textarea
          ref={input}
          value={content}
          onChange={(event) => onChange(event.target.value)}
          maxLength={4000}
          rows={1}
          className="bg-muted/60 min-h-10 resize-none rounded-md border-0 text-sm shadow-none"
          aria-label={t('writeComment')}
          placeholder={name ? t('replyTo', { name }) : t('writeComment')}
          disabled={sending || disabled}
        />
        <Button
          type="submit"
          size="sm"
          className="mb-1 bg-[#07a35a] text-white hover:bg-[#068c4d]"
          disabled={sending || disabled || !content.trim()}
        >
          {sending ? t('sending') : t('send')}
        </Button>
      </div>
    </form>
  );
}
