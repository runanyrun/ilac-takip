import { readFileSync } from 'node:fs';
// Defense in depth. Values are never printed, even on failure.
export function sensitive(text) {
  return /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/.test(text) ||
    /["']?VAPID_PRIVATE(?:_KEY|_JWK)?["']?\s*[:=]\s*["'`][^"'`\s]{16,}/i.test(text) ||
    /["']d["']\s*:\s*["'][A-Za-z0-9_-]{32,}["']/.test(text) ||
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(text) ||
    /https:\/\/(?:fcm\.googleapis\.com\/fcm\/send|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com\/wpush)\/[^\s"'`<>]{12,}/.test(text);
}
export function scanTracked(root, fileList) {
  const files = fileList.split('\0').filter(Boolean);
  return [...new Set(files)].filter(path => sensitive(readFileSync(`${root}/${path}`, 'utf8')));
}
