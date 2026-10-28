/** Browser-safe extension lookup (no `node:path` dependency). */
function extname(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash + 1 ? path.slice(dot) : '';
}

/** Allowed asset file extensions (checked case-insensitively). */
export const ASSET_EXTENSIONS = ['.glb', '.gltf', '.png', '.jpg', '.webp', '.json', '.mp3', '.ogg'] as const;

/**
 * Structural validation of a relative path inside a pack.
 * Returns null when the path is acceptable, otherwise a stable error code.
 *
 * Rules:
 * - must be non-empty, relative, forward-slash only
 * - no absolute forms (`/...`, `C:\`, `file://`, leading `~`)
 * - no `..` segments anywhere (path traversal)
 * - `.` segments are normalized away by `normalizeRelativePath`
 */
export function checkRelativePath(raw: string): string | null {
  if (raw.length === 0) return 'PATH_INVALID';
  if (raw.includes('\0') || raw.includes('\\')) return 'PATH_INVALID';
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.startsWith('file://') || raw.startsWith('~')) {
    return 'PATH_ABSOLUTE';
  }
  for (const segment of raw.split('/')) {
    if (segment === '..') return 'PATH_TRAVERSAL';
    if (segment === '') return 'PATH_INVALID';
  }
  return null;
}

/** Normalize a relative path: collapse `.` segments; caller has already rejected `..`. */
export function normalizeRelativePath(raw: string): string {
  return raw
    .split('/')
    .filter((s) => s !== '.')
    .join('/');
}

/** Case-insensitive extension check against ASSET_EXTENSIONS. */
export function checkAssetExtension(normalizedPath: string): string | null {
  const ext = extname(normalizedPath).toLowerCase();
  if (!(ASSET_EXTENSIONS as readonly string[]).includes(ext)) return 'ASSET_EXT_NOT_ALLOWED';
  return null;
}
