import type { PchVariant } from './flags.ts';

// The prebuilt simulator library ("shim bundle") that every user build links against.
// Produced by scripts/build-shim.ts, published under public/sim/.

export interface ShimManifest {
  /** Content hash of the bundle; part of every object-cache key. */
  version: string;
  headers: string; // gzip JSON: virtual path -> header text
  pch: Record<PchVariant, string>; // gzip PCH per variant
  objects: string; // gzip tar of .o files
  /** C functions declared by the vendored PROS headers (for classifying imports). */
  knownCApi: string[];
  /** Vendored library versions, for template-mismatch warnings. */
  libraries: Record<string, string>;
}

export interface ShimBundle {
  manifest: ShimManifest;
  headers: Record<string, string>;
  /** Loaded lazily: only the variant a project needs is downloaded. */
  pch: Partial<Record<PchVariant, Uint8Array>>;
  objects: Record<string, Uint8Array>;
}

export const LIBRARY_VERSIONS: Record<string, string> = {
  kernel: '4.2.2',
  LemLib: '0.5.6',
  'EZ-Template': '3.2.2',
};
