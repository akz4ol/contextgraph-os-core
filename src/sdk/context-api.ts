/**
 * Context Declaration API for Agent SDK
 *
 * Implements EPIC 8 Capability 8.1:
 * T8.1.1 Provide context declaration methods
 *
 * Context is king. Declare it clearly.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { GraphNode, ContextPayload } from '../core/types/node.js';
import { computeContentAddress } from '../core/identity/content-address.js';

/**
 * Context node type alias for convenience
 */
type ContextNode = GraphNode<ContextPayload>;

/**
 * Context type for the SDK
 */
export const SDKContextType = {
  /** User input or request */
  USER_INPUT: 'USER_INPUT',
  /** External data source */
  EXTERNAL_DATA: 'EXTERNAL_DATA',
  /** System state */
  SYSTEM_STATE: 'SYSTEM_STATE',
  /** Configuration */
  CONFIGURATION: 'CONFIGURATION',
  /** Environmental context */
  ENVIRONMENT: 'ENVIRONMENT',
  /** Previous decision reference */
  DECISION_REFERENCE: 'DECISION_REFERENCE',
  /** Custom context type */
  CUSTOM: 'CUSTOM',
} as const;

export type SDKContextTypeValue = (typeof SDKContextType)[keyof typeof SDKContextType];

/**
 * Context declaration input
 */
export interface DeclareContextInput<T = unknown> {
  /** Context type */
  readonly type: SDKContextTypeValue;
  /** Context data */
  readonly data: T;
  /** Source of the context */
  readonly source: string;
  /** Confidence level (0-1) */
  readonly confidence?: number | undefined;
  /** Tags for categorization */
  readonly tags?: readonly string[] | undefined;
  /** Time-to-live in milliseconds */
  readonly ttlMs?: number | undefined;
  /** Parent context (if derived) */
  readonly parentId?: ContentAddress | undefined;
}

/**
 * Declared context with metadata
 */
export interface DeclaredContext<T = unknown> {
  /** Context ID */
  readonly id: ContentAddress;
  /** Context type */
  readonly type: SDKContextTypeValue;
  /** Context data */
  readonly data: T;
  /** Source of the context */
  readonly source: string;
  /** Confidence level */
  readonly confidence: number;
  /** When it was declared */
  readonly declaredAt: Timestamp;
  /** When it expires (if applicable) */
  readonly expiresAt?: Timestamp;
  /** Tags */
  readonly tags: readonly string[];
  /** Parent context ID */
  readonly parentId?: ContentAddress;
  /** Declaring actor */
  readonly declaredBy: ContentAddress;
}

/**
 * Context query options
 */
export interface ContextQueryOptions {
  /** Filter by type */
  readonly types?: readonly SDKContextTypeValue[];
  /** Filter by tags */
  readonly tags?: readonly string[];
  /** Filter by source */
  readonly source?: string;
  /** Only include non-expired */
  readonly activeOnly?: boolean;
  /** Maximum age in milliseconds */
  readonly maxAgeMs?: number;
  /** Minimum confidence */
  readonly minConfidence?: number;
  /** Limit results */
  readonly limit?: number;
}

/**
 * Context validation result
 */
export interface ContextValidationResult {
  /** Whether the context is valid */
  readonly valid: boolean;
  /** Validation errors */
  readonly errors: readonly string[];
  /** Validation warnings */
  readonly warnings: readonly string[];
}

/**
 * Context API for agents
 */
export class ContextAPI {
  private contexts: Map<ContentAddress, DeclaredContext> = new Map();
  private byType: Map<SDKContextTypeValue, Set<ContentAddress>> = new Map();
  private byTag: Map<string, Set<ContentAddress>> = new Map();
  private currentActorId: ContentAddress;

  constructor(actorId: ContentAddress) {
    this.currentActorId = actorId;
  }

  /**
   * Declare a new context
   */
  declare<T>(input: DeclareContextInput<T>): DeclaredContext<T> {
    // Validate the context
    const validation = this.validate(input);
    if (!validation.valid) {
      throw new Error(`Invalid context: ${validation.errors.join(', ')}`);
    }

    const declaredAt = new Date().toISOString();

    const contextData = {
      type: input.type,
      data: input.data,
      source: input.source,
      declaredAt,
      declaredBy: this.currentActorId,
    };

    const id = computeContentAddress(contextData);

    const baseContext = {
      id,
      type: input.type,
      data: input.data,
      source: input.source,
      confidence: input.confidence ?? 1.0,
      declaredAt,
      tags: input.tags ?? [],
      declaredBy: this.currentActorId,
    };

    // Calculate expiry if TTL is set
    const expiresAt = input.ttlMs !== undefined
      ? new Date(Date.now() + input.ttlMs).toISOString()
      : undefined;

    const context: DeclaredContext<T> = {
      ...baseContext,
      ...(expiresAt !== undefined && { expiresAt }),
      ...(input.parentId !== undefined && { parentId: input.parentId }),
    };

    // Store the context
    this.contexts.set(id, context as DeclaredContext);

    // Index by type
    const typeSet = this.byType.get(input.type) ?? new Set();
    typeSet.add(id);
    this.byType.set(input.type, typeSet);

    // Index by tags
    for (const tag of context.tags) {
      const tagSet = this.byTag.get(tag) ?? new Set();
      tagSet.add(id);
      this.byTag.set(tag, tagSet);
    }

    return context;
  }

  /**
   * Declare user input context
   */
  declareUserInput<T>(data: T, source: string = 'user'): DeclaredContext<T> {
    return this.declare({
      type: SDKContextType.USER_INPUT,
      data,
      source,
      confidence: 1.0,
    });
  }

  /**
   * Declare external data context
   */
  declareExternalData<T>(
    data: T,
    source: string,
    options?: { confidence?: number; ttlMs?: number }
  ): DeclaredContext<T> {
    return this.declare({
      type: SDKContextType.EXTERNAL_DATA,
      data,
      source,
      confidence: options?.confidence ?? 0.9,
      ttlMs: options?.ttlMs,
    });
  }

  /**
   * Declare system state context
   */
  declareSystemState<T>(data: T, source: string = 'system'): DeclaredContext<T> {
    return this.declare({
      type: SDKContextType.SYSTEM_STATE,
      data,
      source,
      confidence: 1.0,
    });
  }

  /**
   * Declare configuration context
   */
  declareConfiguration<T>(data: T, source: string = 'config'): DeclaredContext<T> {
    return this.declare({
      type: SDKContextType.CONFIGURATION,
      data,
      source,
      confidence: 1.0,
    });
  }

  /**
   * Get a context by ID
   */
  get<T = unknown>(id: ContentAddress): DeclaredContext<T> | undefined {
    const context = this.contexts.get(id);
    if (!context) {return undefined;}

    // Check expiry
    if (context.expiresAt && context.expiresAt < new Date().toISOString()) {
      return undefined;
    }

    return context as DeclaredContext<T>;
  }

  /**
   * Query contexts
   */
  query(options: ContextQueryOptions = {}): readonly DeclaredContext[] {
    let results: DeclaredContext[] = [];
    const now = new Date().toISOString();
    const maxAgeThreshold = options.maxAgeMs
      ? new Date(Date.now() - options.maxAgeMs).toISOString()
      : undefined;

    // Start with type filter if specified
    if (options.types && options.types.length > 0) {
      const ids = new Set<ContentAddress>();
      for (const type of options.types) {
        const typeIds = this.byType.get(type);
        if (typeIds) {
          for (const id of typeIds) {
            ids.add(id);
          }
        }
      }
      results = Array.from(ids)
        .map((id) => this.contexts.get(id))
        .filter((c): c is DeclaredContext => c !== undefined);
    } else {
      results = Array.from(this.contexts.values());
    }

    // Apply filters
    results = results.filter((context) => {
      // Active only filter
      if (options.activeOnly && context.expiresAt && context.expiresAt < now) {
        return false;
      }

      // Max age filter
      if (maxAgeThreshold && context.declaredAt < maxAgeThreshold) {
        return false;
      }

      // Source filter
      if (options.source && context.source !== options.source) {
        return false;
      }

      // Min confidence filter
      if (options.minConfidence !== undefined && context.confidence < options.minConfidence) {
        return false;
      }

      // Tags filter
      if (options.tags && options.tags.length > 0) {
        const hasTag = options.tags.some((tag) => context.tags.includes(tag));
        if (!hasTag) {
          return false;
        }
      }

      return true;
    });

    // Sort by declaration time (newest first)
    results.sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));

    // Apply limit
    if (options.limit !== undefined) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get all contexts of a specific type
   */
  getByType(type: SDKContextTypeValue): readonly DeclaredContext[] {
    return this.query({ types: [type], activeOnly: true });
  }

  /**
   * Get all contexts with a specific tag
   */
  getByTag(tag: string): readonly DeclaredContext[] {
    return this.query({ tags: [tag], activeOnly: true });
  }

  /**
   * Get the most recent context of a type
   */
  getLatest(type: SDKContextTypeValue): DeclaredContext | undefined {
    const results = this.query({ types: [type], activeOnly: true, limit: 1 });
    return results[0];
  }

  /**
   * Validate context before declaration
   */
  validate<T>(input: DeclareContextInput<T>): ContextValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!input.type) {
      errors.push('Context type is required');
    }

    if (input.data === undefined || input.data === null) {
      errors.push('Context data is required');
    }

    if (!input.source) {
      errors.push('Context source is required');
    }

    // Confidence validation
    if (input.confidence !== undefined) {
      if (input.confidence < 0 || input.confidence > 1) {
        errors.push('Confidence must be between 0 and 1');
      }
      if (input.confidence < 0.5) {
        warnings.push('Low confidence context may lead to unreliable decisions');
      }
    }

    // TTL validation
    if (input.ttlMs !== undefined && input.ttlMs <= 0) {
      errors.push('TTL must be positive');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Invalidate a context
   */
  invalidate(id: ContentAddress): boolean {
    const context = this.contexts.get(id);
    if (!context) {
      return false;
    }

    // Remove from indexes
    const typeSet = this.byType.get(context.type);
    if (typeSet) {
      typeSet.delete(id);
    }

    for (const tag of context.tags) {
      const tagSet = this.byTag.get(tag);
      if (tagSet) {
        tagSet.delete(id);
      }
    }

    this.contexts.delete(id);
    return true;
  }

  /**
   * Clean up expired contexts
   */
  cleanupExpired(): number {
    const now = new Date().toISOString();
    let cleaned = 0;

    for (const [id, context] of this.contexts) {
      if (context.expiresAt && context.expiresAt < now) {
        this.invalidate(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Convert to ContextNode for storage
   */
  toContextNode(context: DeclaredContext): ContextNode {
    const payload: ContextPayload = {
      schemaVersion: '1.0',
      source: context.source,
      data: context.data,
      contentType: 'application/json',
      metadata: {
        contextType: context.type,
        confidence: context.confidence,
      },
    };

    return {
      id: context.id,
      type: 'CONTEXT',
      createdAt: context.declaredAt,
      createdBy: context.declaredBy,
      status: 'ACTIVE',
      validity: {
        validFrom: context.declaredAt,
        validUntil: context.expiresAt,
      },
      payload,
    };
  }

  /**
   * Get statistics about declared contexts
   */
  getStats(): {
    total: number;
    active: number;
    expired: number;
    byType: Record<SDKContextTypeValue, number>;
    avgConfidence: number;
  } {
    const now = new Date().toISOString();
    let active = 0;
    let expired = 0;
    let totalConfidence = 0;
    const byType: Record<string, number> = {};

    for (const context of this.contexts.values()) {
      if (context.expiresAt && context.expiresAt < now) {
        expired++;
      } else {
        active++;
      }

      byType[context.type] = (byType[context.type] ?? 0) + 1;
      totalConfidence += context.confidence;
    }

    return {
      total: this.contexts.size,
      active,
      expired,
      byType: byType as Record<SDKContextTypeValue, number>,
      avgConfidence: this.contexts.size > 0 ? totalConfidence / this.contexts.size : 0,
    };
  }
}

/**
 * Create a context API for an agent
 */
export function createContextAPI(actorId: ContentAddress): ContextAPI {
  return new ContextAPI(actorId);
}
