/**
 * Error model for pack validation.
 * Every problem is reported as a `PackError` with a stable machine-readable
 * `code`, an optional `field` (manifest path, e.g. `components.0.assetRef`)
 * and an optional filesystem `path` relative to the pack root.
 */
export type PackErrorCode =
  | 'PACK_DIR_NOT_FOUND'
  | 'MANIFEST_MISSING'
  | 'MANIFEST_READ_ERROR'
  | 'MANIFEST_PARSE'
  | 'MANIFEST_TOO_LARGE'
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'PACK_ID_FORMAT'
  | 'PACK_ID_LENGTH'
  | 'SEMVER_FORMAT'
  | 'OBJECT_KIND_UNKNOWN'
  | 'PLAYERS_RANGE'
  | 'UNKNOWN_FIELD'
  | 'REQUIRED'
  | 'TYPE'
  | 'SCHEMA'
  | 'PATH_ABSOLUTE'
  | 'PATH_TRAVERSAL'
  | 'PATH_INVALID'
  | 'PATH_ESCAPE'
  | 'ASSET_EXT_NOT_ALLOWED'
  | 'ASSET_MISSING'
  | 'ASSET_NAME_FORMAT'
  | 'ASSET_REF_UNKNOWN'
  | 'ASSET_DUPLICATE_PATH'
  | 'SYMLINK_FORBIDDEN'
  | 'FILE_TOO_LARGE'
  | 'PACK_SIZE_EXCEEDED'
  | 'FILE_COUNT_EXCEEDED'
  | 'ID_DUPLICATE';

/** One validation problem. */
export interface PackError {
  code: PackErrorCode | string;
  /** Manifest field path or undefined for filesystem-level errors. */
  field?: string;
  /** Path relative to the pack root, when relevant. */
  path?: string;
  /** Human-readable description. */
  message: string;
}

export function packError(
  code: PackErrorCode | (string & {}),
  message: string,
  extra?: { field?: string; path?: string },
): PackError {
  return { code, message, ...extra };
}
