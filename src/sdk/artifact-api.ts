/**
 * Artifact Registration API for Agent SDK
 *
 * Implements EPIC 8 Capability 8.1:
 * T8.1.3 Provide artifact registration methods
 *
 * What you produce matters. Track it.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { GraphNode, ArtifactPayload } from '../core/types/node.js';
import { computeContentAddress } from '../core/identity/content-address.js';

/**
 * Artifact node type alias for convenience
 */
type ArtifactNode = GraphNode<ArtifactPayload>;

/**
 * Artifact type
 */
export const ArtifactType = {
  /** Code or source file */
  CODE: 'CODE',
  /** Document or text */
  DOCUMENT: 'DOCUMENT',
  /** Data output */
  DATA: 'DATA',
  /** Configuration */
  CONFIG: 'CONFIG',
  /** Log or trace */
  LOG: 'LOG',
  /** Report */
  REPORT: 'REPORT',
  /** Media (image, video, audio) */
  MEDIA: 'MEDIA',
  /** Custom artifact */
  CUSTOM: 'CUSTOM',
} as const;

export type ArtifactTypeValue = (typeof ArtifactType)[keyof typeof ArtifactType];

/**
 * Artifact registration input
 */
export interface RegisterArtifactInput {
  /** Artifact type */
  readonly type: ArtifactTypeValue;
  /** Content or reference to content */
  readonly content: string | object;
  /** MIME type */
  readonly mimeType?: string | undefined;
  /** File path (if applicable) */
  readonly filePath?: string | undefined;
  /** Decision that produced this artifact */
  readonly producedByDecisionId: ContentAddress;
  /** Description */
  readonly description?: string | undefined;
  /** Tags for categorization */
  readonly tags?: readonly string[] | undefined;
  /** Metadata */
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Registered artifact
 */
export interface RegisteredArtifact {
  /** Artifact ID (content hash) */
  readonly id: ContentAddress;
  /** Artifact type */
  readonly type: ArtifactTypeValue;
  /** Content hash */
  readonly contentHash: ContentAddress;
  /** MIME type */
  readonly mimeType: string;
  /** File path (if applicable) */
  readonly filePath?: string;
  /** Decision that produced this artifact */
  readonly producedByDecisionId: ContentAddress;
  /** Description */
  readonly description?: string;
  /** Tags */
  readonly tags: readonly string[];
  /** Metadata */
  readonly metadata: Record<string, unknown>;
  /** When it was registered */
  readonly registeredAt: Timestamp;
  /** Who registered it */
  readonly registeredBy: ContentAddress;
  /** Size in bytes (if applicable) */
  readonly sizeBytes?: number;
}

/**
 * Artifact query options
 */
export interface ArtifactQueryOptions {
  /** Filter by type */
  readonly types?: readonly ArtifactTypeValue[];
  /** Filter by decision */
  readonly decisionId?: ContentAddress;
  /** Filter by tags */
  readonly tags?: readonly string[];
  /** Limit results */
  readonly limit?: number;
}

/**
 * Artifact API for agents
 */
export class ArtifactAPI {
  private artifacts: Map<ContentAddress, RegisteredArtifact> = new Map();
  private byDecision: Map<ContentAddress, Set<ContentAddress>> = new Map();
  private byType: Map<ArtifactTypeValue, Set<ContentAddress>> = new Map();
  private byTag: Map<string, Set<ContentAddress>> = new Map();
  private currentActorId: ContentAddress;

  constructor(actorId: ContentAddress) {
    this.currentActorId = actorId;
  }

  /**
   * Register a new artifact
   */
  register(input: RegisterArtifactInput): RegisteredArtifact {
    const registeredAt = new Date().toISOString();

    // Compute content hash
    const contentHash = computeContentAddress(input.content);

    // Compute artifact ID
    const artifactData = {
      contentHash,
      producedByDecisionId: input.producedByDecisionId,
      registeredAt,
    };
    const id = computeContentAddress(artifactData);

    // Determine size
    const sizeBytes = typeof input.content === 'string'
      ? Buffer.byteLength(input.content, 'utf8')
      : Buffer.byteLength(JSON.stringify(input.content), 'utf8');

    // Default MIME type based on artifact type
    const defaultMimeTypes: Record<ArtifactTypeValue, string> = {
      CODE: 'text/plain',
      DOCUMENT: 'text/plain',
      DATA: 'application/json',
      CONFIG: 'application/json',
      LOG: 'text/plain',
      REPORT: 'text/html',
      MEDIA: 'application/octet-stream',
      CUSTOM: 'application/octet-stream',
    };

    const baseArtifact = {
      id,
      type: input.type,
      contentHash,
      mimeType: input.mimeType ?? defaultMimeTypes[input.type],
      producedByDecisionId: input.producedByDecisionId,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      registeredAt,
      registeredBy: this.currentActorId,
      sizeBytes,
    };

    const artifact: RegisteredArtifact = {
      ...baseArtifact,
      ...(input.filePath !== undefined && { filePath: input.filePath }),
      ...(input.description !== undefined && { description: input.description }),
    };

    // Store
    this.artifacts.set(id, artifact);

    // Index by decision
    const decisionSet = this.byDecision.get(input.producedByDecisionId) ?? new Set();
    decisionSet.add(id);
    this.byDecision.set(input.producedByDecisionId, decisionSet);

    // Index by type
    const typeSet = this.byType.get(input.type) ?? new Set();
    typeSet.add(id);
    this.byType.set(input.type, typeSet);

    // Index by tags
    for (const tag of artifact.tags) {
      const tagSet = this.byTag.get(tag) ?? new Set();
      tagSet.add(id);
      this.byTag.set(tag, tagSet);
    }

    return artifact;
  }

  /**
   * Register a code artifact
   */
  registerCode(
    code: string,
    decisionId: ContentAddress,
    options?: {
      filePath?: string;
      language?: string;
      description?: string;
    }
  ): RegisteredArtifact {
    const mimeTypes: Record<string, string> = {
      typescript: 'text/typescript',
      javascript: 'text/javascript',
      python: 'text/x-python',
      java: 'text/x-java',
      go: 'text/x-go',
    };

    return this.register({
      type: ArtifactType.CODE,
      content: code,
      mimeType: options?.language ? mimeTypes[options.language] ?? 'text/plain' : 'text/plain',
      producedByDecisionId: decisionId,
      filePath: options?.filePath,
      description: options?.description,
      metadata: options?.language ? { language: options.language } : {},
    });
  }

  /**
   * Register a document artifact
   */
  registerDocument(
    content: string,
    decisionId: ContentAddress,
    options?: {
      format?: 'text' | 'markdown' | 'html';
      description?: string;
    }
  ): RegisteredArtifact {
    const mimeTypes = {
      text: 'text/plain',
      markdown: 'text/markdown',
      html: 'text/html',
    };

    return this.register({
      type: ArtifactType.DOCUMENT,
      content,
      mimeType: mimeTypes[options?.format ?? 'text'],
      producedByDecisionId: decisionId,
      description: options?.description,
    });
  }

  /**
   * Register a data artifact
   */
  registerData<T extends object>(
    data: T,
    decisionId: ContentAddress,
    options?: {
      description?: string;
      tags?: readonly string[];
    }
  ): RegisteredArtifact {
    return this.register({
      type: ArtifactType.DATA,
      content: data,
      mimeType: 'application/json',
      producedByDecisionId: decisionId,
      description: options?.description,
      tags: options?.tags,
    });
  }

  /**
   * Register a log artifact
   */
  registerLog(
    log: string,
    decisionId: ContentAddress,
    description?: string
  ): RegisteredArtifact {
    return this.register({
      type: ArtifactType.LOG,
      content: log,
      mimeType: 'text/plain',
      producedByDecisionId: decisionId,
      description: description ?? 'Execution log',
      tags: ['log'],
    });
  }

  /**
   * Get an artifact by ID
   */
  get(id: ContentAddress): RegisteredArtifact | undefined {
    return this.artifacts.get(id);
  }

  /**
   * Query artifacts
   */
  query(options: ArtifactQueryOptions = {}): readonly RegisteredArtifact[] {
    let results: RegisteredArtifact[] = [];

    // Start with decision filter if specified
    if (options.decisionId) {
      const ids = this.byDecision.get(options.decisionId);
      if (!ids) {
        return [];
      }
      results = Array.from(ids)
        .map((id) => this.artifacts.get(id))
        .filter((a): a is RegisteredArtifact => a !== undefined);
    } else {
      results = Array.from(this.artifacts.values());
    }

    // Apply type filter
    if (options.types && options.types.length > 0) {
      results = results.filter((a) => options.types!.includes(a.type));
    }

    // Apply tag filter
    if (options.tags && options.tags.length > 0) {
      results = results.filter((a) =>
        options.tags!.some((tag) => a.tags.includes(tag))
      );
    }

    // Sort by registration time (newest first)
    results.sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));

    // Apply limit
    if (options.limit !== undefined) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get all artifacts produced by a decision
   */
  getByDecision(decisionId: ContentAddress): readonly RegisteredArtifact[] {
    return this.query({ decisionId });
  }

  /**
   * Get all artifacts of a type
   */
  getByType(type: ArtifactTypeValue): readonly RegisteredArtifact[] {
    return this.query({ types: [type] });
  }

  /**
   * Convert to ArtifactNode for storage
   */
  toArtifactNode(artifact: RegisteredArtifact): ArtifactNode {
    const payload: ArtifactPayload = {
      schemaVersion: '1.0',
      artifactType: artifact.type,
      contentHash: artifact.contentHash,
      mimeType: artifact.mimeType,
      location: artifact.filePath,
      size: artifact.sizeBytes,
    };

    return {
      id: artifact.id,
      type: 'ARTIFACT',
      createdAt: artifact.registeredAt,
      createdBy: artifact.registeredBy,
      status: 'ACTIVE',
      validity: {
        validFrom: artifact.registeredAt,
      },
      payload,
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byType: Record<ArtifactTypeValue, number>;
    totalSizeBytes: number;
  } {
    const byType: Record<string, number> = {};
    let totalSizeBytes = 0;

    for (const artifact of this.artifacts.values()) {
      byType[artifact.type] = (byType[artifact.type] ?? 0) + 1;
      totalSizeBytes += artifact.sizeBytes ?? 0;
    }

    return {
      total: this.artifacts.size,
      byType: byType as Record<ArtifactTypeValue, number>,
      totalSizeBytes,
    };
  }
}

/**
 * Create an artifact API for an agent
 */
export function createArtifactAPI(actorId: ContentAddress): ArtifactAPI {
  return new ArtifactAPI(actorId);
}
