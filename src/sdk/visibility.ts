/**
 * Visibility & Progressive Disclosure for Agent SDK
 *
 * Implements EPIC 8 Capability 8.2:
 * T8.2.1 Agents see only permitted context
 * T8.2.2 Agents receive policy feedback in real-time
 *
 * See what you need. Know what you can't.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Actor } from '../actor/identity.js';
import type { AuthorityChecker, AuthorityLevelValue } from '../actor/authority.js';
import type { DeclaredContext } from './context-api.js';
import type { PolicyFeedback } from './decision-api.js';

/**
 * Visibility level
 */
export const VisibilityLevel = {
  /** No visibility */
  NONE: 'NONE',
  /** Can see metadata only */
  METADATA: 'METADATA',
  /** Can see summary */
  SUMMARY: 'SUMMARY',
  /** Full visibility */
  FULL: 'FULL',
} as const;

export type VisibilityLevelValue = (typeof VisibilityLevel)[keyof typeof VisibilityLevel];

/**
 * Visibility rule
 */
export interface VisibilityRule {
  /** Rule ID */
  readonly id: string;
  /** Scope pattern this rule applies to */
  readonly scopePattern: string;
  /** Minimum authority level required for full visibility */
  readonly minAuthorityForFull: AuthorityLevelValue;
  /** Minimum authority level required for summary */
  readonly minAuthorityForSummary: AuthorityLevelValue;
  /** Fields that are always hidden */
  readonly hiddenFields?: readonly string[];
  /** Fields that require elevation */
  readonly sensitiveFields?: readonly string[];
}

/**
 * Filtered context (with visibility applied)
 */
export interface FilteredContext<T = unknown> {
  /** Original context ID */
  readonly id: ContentAddress;
  /** Visibility level applied */
  readonly visibilityLevel: VisibilityLevelValue;
  /** Filtered data (based on visibility) */
  readonly data: T | ContextSummary | ContextMetadata | null;
  /** Whether full access was denied */
  readonly restricted: boolean;
  /** Reason for restriction (if any) */
  readonly restrictionReason?: string;
}

/**
 * Context summary for limited visibility
 */
export interface ContextSummary {
  /** Context type */
  readonly type: string;
  /** Source */
  readonly source: string;
  /** When it was declared */
  readonly declaredAt: string;
  /** Summary description */
  readonly summary: string;
}

/**
 * Context metadata for minimal visibility
 */
export interface ContextMetadata {
  /** Context type */
  readonly type: string;
  /** When it was declared */
  readonly declaredAt: string;
  /** Whether the context exists */
  readonly exists: boolean;
}

/**
 * Policy feedback event
 */
export interface FeedbackEvent {
  /** Event ID */
  readonly id: string;
  /** Event type */
  readonly type: 'violation' | 'warning' | 'info' | 'suggestion';
  /** Feedback content */
  readonly feedback: PolicyFeedback;
  /** When it occurred */
  readonly timestamp: string;
  /** Related action/decision */
  readonly relatedTo?: ContentAddress;
}

/**
 * Feedback listener callback
 */
export type FeedbackListener = (event: FeedbackEvent) => void;

/**
 * Visibility Manager
 *
 * Controls what agents can see and provides real-time feedback.
 */
export class VisibilityManager {
  private rules: Map<string, VisibilityRule> = new Map();
  private listeners: Map<ContentAddress, FeedbackListener[]> = new Map();
  private feedbackBuffer: Map<ContentAddress, FeedbackEvent[]> = new Map();
  private authorityChecker?: AuthorityChecker;
  private eventCounter = 0;

  /**
   * Set the authority checker
   */
  setAuthorityChecker(checker: AuthorityChecker): void {
    this.authorityChecker = checker;
  }

  /**
   * Add a visibility rule
   */
  addRule(rule: VisibilityRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Remove a visibility rule
   */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  /**
   * Filter a context based on actor's visibility
   */
  filterContext<T>(
    context: DeclaredContext<T>,
    actor: Actor,
    scope: string
  ): FilteredContext<T> {
    const visibilityLevel = this.getVisibilityLevel(actor, scope);

    switch (visibilityLevel) {
      case VisibilityLevel.FULL:
        return {
          id: context.id,
          visibilityLevel,
          data: this.filterSensitiveFields(context.data, actor, scope),
          restricted: false,
        };

      case VisibilityLevel.SUMMARY:
        return {
          id: context.id,
          visibilityLevel,
          data: {
            type: context.type,
            source: context.source,
            declaredAt: context.declaredAt,
            summary: this.generateSummary(context),
          } as unknown as T,
          restricted: true,
          restrictionReason: 'Limited to summary view',
        };

      case VisibilityLevel.METADATA:
        return {
          id: context.id,
          visibilityLevel,
          data: {
            type: context.type,
            declaredAt: context.declaredAt,
            exists: true,
          } as unknown as T,
          restricted: true,
          restrictionReason: 'Limited to metadata only',
        };

      case VisibilityLevel.NONE:
      default:
        return {
          id: context.id,
          visibilityLevel: VisibilityLevel.NONE,
          data: null,
          restricted: true,
          restrictionReason: 'Access denied',
        };
    }
  }

  /**
   * Filter multiple contexts
   */
  filterContexts<T>(
    contexts: readonly DeclaredContext<T>[],
    actor: Actor,
    scope: string
  ): readonly FilteredContext<T>[] {
    return contexts.map((ctx) => this.filterContext(ctx, actor, scope));
  }

  /**
   * Get visibility level for an actor on a scope
   */
  getVisibilityLevel(actor: Actor, scope: string): VisibilityLevelValue {
    // Find matching rule
    const rule = this.findMatchingRule(scope);

    if (!rule) {
      // Default: full visibility if no rule
      return VisibilityLevel.FULL;
    }

    // Check authority level
    let authorityLevel: AuthorityLevelValue = 0; // NONE
    if (this.authorityChecker) {
      authorityLevel = this.authorityChecker.getEffectiveLevel(actor, scope);
    } else {
      // Without checker, parse from actor's authorities
      authorityLevel = this.getAuthorityFromActor(actor, scope);
    }

    if (authorityLevel >= rule.minAuthorityForFull) {
      return VisibilityLevel.FULL;
    }

    if (authorityLevel >= rule.minAuthorityForSummary) {
      return VisibilityLevel.SUMMARY;
    }

    if (authorityLevel > 0) {
      return VisibilityLevel.METADATA;
    }

    return VisibilityLevel.NONE;
  }

  /**
   * Subscribe to policy feedback
   */
  subscribeFeedback(actorId: ContentAddress, listener: FeedbackListener): () => void {
    const listeners = this.listeners.get(actorId) ?? [];
    listeners.push(listener);
    this.listeners.set(actorId, listeners);

    // Send buffered feedback
    const buffered = this.feedbackBuffer.get(actorId) ?? [];
    for (const event of buffered) {
      listener(event);
    }
    this.feedbackBuffer.delete(actorId);

    // Return unsubscribe function
    return () => {
      const current = this.listeners.get(actorId) ?? [];
      const index = current.indexOf(listener);
      if (index >= 0) {
        current.splice(index, 1);
      }
    };
  }

  /**
   * Emit policy feedback to an actor
   */
  emitFeedback(
    actorId: ContentAddress,
    feedback: PolicyFeedback,
    relatedTo?: ContentAddress
  ): void {
    const event: FeedbackEvent = {
      id: `feedback-${++this.eventCounter}`,
      type: feedback.type,
      feedback,
      timestamp: new Date().toISOString(),
      ...(relatedTo !== undefined && { relatedTo }),
    };

    const listeners = this.listeners.get(actorId);
    if (listeners && listeners.length > 0) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Ignore listener errors
        }
      }
    } else {
      // Buffer feedback if no listeners
      const buffer = this.feedbackBuffer.get(actorId) ?? [];
      buffer.push(event);
      this.feedbackBuffer.set(actorId, buffer);
    }
  }

  /**
   * Emit multiple feedback items
   */
  emitMultipleFeedback(
    actorId: ContentAddress,
    feedbackItems: readonly PolicyFeedback[],
    relatedTo?: ContentAddress
  ): void {
    for (const feedback of feedbackItems) {
      this.emitFeedback(actorId, feedback, relatedTo);
    }
  }

  // Private helper methods

  private findMatchingRule(scope: string): VisibilityRule | undefined {
    for (const rule of this.rules.values()) {
      if (this.scopeMatches(rule.scopePattern, scope)) {
        return rule;
      }
    }
    return undefined;
  }

  private scopeMatches(pattern: string, target: string): boolean {
    if (pattern === '*') return true;

    const patternParts = pattern.split(':');
    const targetParts = target.split(':');

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '*') {
        if (i === patternParts.length - 1) return true;
        continue;
      }
      if (patternParts[i] !== targetParts[i]) {
        return false;
      }
    }

    return patternParts.length <= targetParts.length;
  }

  private getAuthorityFromActor(actor: Actor, scope: string): AuthorityLevelValue {
    // Simple authority parsing from actor's authorities
    const levelMap: Record<string, AuthorityLevelValue> = {
      none: 0,
      read: 1,
      propose: 2,
      execute: 3,
      approve: 4,
      admin: 5,
    };

    let maxLevel: AuthorityLevelValue = 0;

    for (const auth of actor.authorities) {
      const parts = auth.split(':');
      const levelStr = parts[parts.length - 1]?.toLowerCase();
      const authScope = parts.slice(0, -1).join(':');

      if (levelStr && this.scopeMatches(authScope, scope)) {
        const level = levelMap[levelStr] ?? 0;
        maxLevel = Math.max(maxLevel, level) as AuthorityLevelValue;
      }
    }

    return maxLevel;
  }

  private filterSensitiveFields<T>(data: T, actor: Actor, scope: string): T {
    const rule = this.findMatchingRule(scope);
    if (!rule || !rule.sensitiveFields) {
      return data;
    }

    // Check if actor has elevated access
    const authorityLevel = this.getAuthorityFromActor(actor, scope);
    if (authorityLevel >= 4) { // APPROVE level or higher
      return data;
    }

    // Filter sensitive fields
    if (typeof data === 'object' && data !== null) {
      const filtered = { ...data } as Record<string, unknown>;
      for (const field of rule.sensitiveFields) {
        if (field in filtered) {
          filtered[field] = '[REDACTED]';
        }
      }
      return filtered as T;
    }

    return data;
  }

  private generateSummary<T>(context: DeclaredContext<T>): string {
    return `Context of type ${context.type} from ${context.source}`;
  }
}

/**
 * Create a visibility manager
 */
export function createVisibilityManager(): VisibilityManager {
  return new VisibilityManager();
}

/**
 * Default visibility rules
 */
export const DefaultVisibilityRules: readonly VisibilityRule[] = [
  {
    id: 'financial-data',
    scopePattern: 'financial:*',
    minAuthorityForFull: 3, // EXECUTE
    minAuthorityForSummary: 1, // READ
    sensitiveFields: ['accountNumber', 'ssn', 'creditCard'],
  },
  {
    id: 'personal-data',
    scopePattern: 'personal:*',
    minAuthorityForFull: 4, // APPROVE
    minAuthorityForSummary: 2, // PROPOSE
    hiddenFields: ['password', 'secret'],
    sensitiveFields: ['email', 'phone', 'address'],
  },
  {
    id: 'system-config',
    scopePattern: 'system:config:*',
    minAuthorityForFull: 5, // ADMIN
    minAuthorityForSummary: 3, // EXECUTE
    hiddenFields: ['apiKey', 'secret', 'token'],
  },
];
