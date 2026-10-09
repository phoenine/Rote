import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UserAvatar from './UserAvatar';

function imageResult(result: 'load' | 'error') {
  class TestImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    complete = false;
    naturalWidth = 0;
    private value = '';
    set src(value: string) {
      this.value = value;
      queueMicrotask(() => {
        if (result === 'load') {
          this.complete = true;
          this.naturalWidth = 128;
          this.onload?.();
        } else this.onerror?.();
      });
    }
    get src() {
      return this.value;
    }
    addEventListener(event: string, callback: () => void) {
      if (event === 'load') this.onload = callback;
      if (event === 'error') this.onerror = callback;
    }
    removeEventListener() {}
  }
  vi.stubGlobal('Image', TestImage);
}

afterEach(() => vi.unstubAllGlobals());

describe('user avatar loading', () => {
  it('shows the default image when the stored avatar URL fails', async () => {
    imageResult('error');
    const { container } = render(<UserAvatar avatar="https://cos.example/avatar.webp" />);
    await waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute('src', '/DefaultAvatar.svg')
    );
  });
  it('shows a successfully loaded avatar and hides the fallback', async () => {
    imageResult('load');
    const { container } = render(<UserAvatar avatar="https://cos.example/avatar.webp" />);
    await waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute(
        'src',
        'https://cos.example/avatar.webp'
      )
    );
    expect(container.querySelector('[data-slot="avatar-fallback"]')).toBeNull();
  });
  it('shows the default avatar when no URL is saved', () => {
    const { container } = render(<UserAvatar />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/DefaultAvatar.svg');
  });
});
