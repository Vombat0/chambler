export interface PackLimits {
  /** Total size of all files in the pack. */
  maxTotalBytes: number;
  /** Maximum number of files in the pack (including manifest.json). */
  maxFiles: number;
  /** Maximum size of a single file. */
  maxFileBytes: number;
  /** Maximum size of manifest.json itself. */
  maxManifestBytes: number;
}

export const DEFAULT_PACK_LIMITS: PackLimits = {
  maxTotalBytes: 200 * 1024 * 1024, // 200 MB
  maxFiles: 2000,
  maxFileBytes: 50 * 1024 * 1024, // 50 MB per file
  maxManifestBytes: 1024 * 1024, // 1 MB manifest
};
