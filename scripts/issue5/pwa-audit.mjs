// Metadata only: do not pass subscriptions, credentials or medication records.
export function identity(manifest, manifestUrl) {
  const url = new URL(manifestUrl);
  const start = new URL(manifest.start_url || '.', url);
  const scope = new URL(manifest.scope || './', start);
  const id = new URL(manifest.id || start.href, start.origin);
  id.hash = '';
  if (start.origin !== url.origin || scope.origin !== start.origin || id.origin !== start.origin || !start.pathname.startsWith(scope.pathname)) throw new Error('Invalid PWA identity or scope');
  return { origin: start.origin, id: id.href, startUrl: start.href, scope: scope.href };
}
export function auditPwa(oldManifest, oldUrl, nextManifest, nextUrl) {
  const previous = identity(oldManifest, oldUrl);
  const next = identity(nextManifest, nextUrl);
  return { previous, next, sameOrigin: previous.origin === next.origin, sameIdentity: previous.id === next.id, requiresUserVerifiedBackup: true, automaticLocalStorageTransfer: false, removalAllowed: false };
}
