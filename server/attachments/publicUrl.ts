/** Public attachment URLs must be absolute; otherwise browsers resolve them against the app. */
export function normalizeStorageUrlPrefix(prefix: string): string {
  const normalized = prefix.trim().replace(/\/+$/, '');
  const url = new URL(normalized);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !/^https?:\/\//i.test(normalized) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Storage URL prefix must be an absolute HTTP(S) URL without credentials, query or fragment'
    );
  }
  return normalized;
}
