/**
 * Content-Addressable Identity System for ContextGraph OS
 *
 * Implements T0.1.4: Define global ID strategy (deterministic, content-addressable)
 *
 * All identifiers in ContextGraph are derived from content, ensuring:
 * - Determinism: Same content always produces same ID
 * - Integrity: Any modification changes the ID
 * - Immutability: IDs are stable references to specific content states
 */

import { createHash } from 'crypto';

/**
 * Content address format: {algorithm}:{hash}
 * Example: sha256:abc123...
 */
export type ContentAddress = `${string}:${string}`;

/**
 * Supported hash algorithms
 */
export const HashAlgorithm = {
  SHA256: 'sha256',
  SHA384: 'sha384',
  SHA512: 'sha512',
} as const;

export type HashAlgorithmValue = (typeof HashAlgorithm)[keyof typeof HashAlgorithm];

/**
 * Default hash algorithm
 */
export const DEFAULT_HASH_ALGORITHM: HashAlgorithmValue = HashAlgorithm.SHA256;

/**
 * Configuration for content addressing
 */
export interface ContentAddressConfig {
  readonly algorithm: HashAlgorithmValue;
  /** Number of characters for the hash (default: full hash) */
  readonly truncateLength?: number;
}

const DEFAULT_CONFIG: ContentAddressConfig = {
  algorithm: DEFAULT_HASH_ALGORITHM,
};

/**
 * Canonicalize an object for consistent hashing
 * Ensures the same object always produces the same hash regardless of key order
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`);
    return '{' + pairs.join(',') + '}';
  }

  // For other types (functions, symbols, etc.), use string representation
  return String(value);
}

/**
 * Compute a content address for any serializable value
 */
export function computeContentAddress(
  content: unknown,
  config: ContentAddressConfig = DEFAULT_CONFIG
): ContentAddress {
  const canonical = canonicalize(content);
  const hash = createHash(config.algorithm).update(canonical, 'utf8').digest('hex');

  const finalHash = config.truncateLength ? hash.slice(0, config.truncateLength) : hash;

  return `${config.algorithm}:${finalHash}`;
}

/**
 * Parse a content address into its components
 */
export function parseContentAddress(
  address: ContentAddress
): { algorithm: string; hash: string } | null {
  const colonIndex = address.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  const algorithm = address.slice(0, colonIndex);
  const hash = address.slice(colonIndex + 1);

  if (!algorithm || !hash) {
    return null;
  }

  return { algorithm, hash };
}

/**
 * Validate a content address format
 */
export function isValidContentAddress(address: string): address is ContentAddress {
  const parsed = parseContentAddress(address as ContentAddress);
  if (!parsed) {
    return false;
  }

  // Check if algorithm is supported
  const supportedAlgorithms = Object.values(HashAlgorithm);
  if (!supportedAlgorithms.includes(parsed.algorithm as HashAlgorithmValue)) {
    return false;
  }

  // Check if hash is valid hex
  return /^[a-f0-9]+$/i.test(parsed.hash);
}

/**
 * Verify that content matches a given address
 */
export function verifyContentAddress(
  content: unknown,
  address: ContentAddress,
  config?: ContentAddressConfig
): boolean {
  const parsed = parseContentAddress(address);
  if (!parsed) {
    return false;
  }

  const verifyConfig: ContentAddressConfig =
    config?.truncateLength !== undefined
      ? { algorithm: parsed.algorithm as HashAlgorithmValue, truncateLength: config.truncateLength }
      : { algorithm: parsed.algorithm as HashAlgorithmValue };

  const computedAddress = computeContentAddress(content, verifyConfig);

  return computedAddress === address;
}

/**
 * Generate a new random content address (for testing/placeholder purposes)
 * This should NOT be used in production - real IDs must be content-derived
 */
export function generateRandomAddress(
  algorithm: HashAlgorithmValue = DEFAULT_HASH_ALGORITHM
): ContentAddress {
  const randomBytes = createHash(algorithm)
    .update(Math.random().toString() + Date.now().toString())
    .digest('hex');

  return `${algorithm}:${randomBytes}`;
}

/**
 * Create a content address from a pre-computed hash
 */
export function createContentAddress(
  algorithm: HashAlgorithmValue,
  hash: string
): ContentAddress {
  return `${algorithm}:${hash}`;
}
