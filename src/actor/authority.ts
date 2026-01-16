/**
 * Authority Scoping for ContextGraph OS
 *
 * Implements EPIC 5 Capability 5.2:
 * T5.2.1 Define authority levels
 * T5.2.2 Bind authority to policy scopes
 * T5.2.3 Enforce authority checks at decision time
 *
 * Unauthorized actions cannot commit.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Actor } from './identity.js';
import type { PolicyDefinition } from '../policy/schema.js';

/**
 * Authority level hierarchy
 */
export const AuthorityLevel = {
  /** No access */
  NONE: 0,
  /** Read-only access */
  READ: 1,
  /** Can propose but not commit */
  PROPOSE: 2,
  /** Can execute within scope */
  EXECUTE: 3,
  /** Can approve others' proposals */
  APPROVE: 4,
  /** Full administrative access */
  ADMIN: 5,
} as const;

export type AuthorityLevelValue = (typeof AuthorityLevel)[keyof typeof AuthorityLevel];

/**
 * Authority scope definition
 */
export interface AuthorityScope {
  /** Scope identifier (e.g., "financial:transactions:*") */
  readonly scope: string;
  /** Authority level for this scope */
  readonly level: AuthorityLevelValue;
  /** Constraints on this authority */
  readonly constraints?: AuthorityConstraint[];
}

/**
 * Constraint on authority
 */
export interface AuthorityConstraint {
  /** Constraint type */
  readonly type: 'amount_limit' | 'time_window' | 'rate_limit' | 'require_mfa' | 'custom';
  /** Constraint parameters */
  readonly parameters: Record<string, unknown>;
}

/**
 * Authority grant record
 */
export interface AuthorityGrant {
  /** The actor receiving the grant */
  readonly actorId: ContentAddress;
  /** Scopes being granted */
  readonly scopes: readonly AuthorityScope[];
  /** Who granted this authority */
  readonly grantedBy: ContentAddress;
  /** When it was granted */
  readonly grantedAt: string;
  /** When it expires (if applicable) */
  readonly expiresAt?: string;
  /** Reason for the grant */
  readonly reason?: string;
}

/**
 * Authority check result
 */
export interface AuthorityCheckResult {
  /** Whether the action is authorized */
  readonly authorized: boolean;
  /** Required authority level */
  readonly requiredLevel: AuthorityLevelValue;
  /** Actor's effective level */
  readonly actualLevel: AuthorityLevelValue;
  /** Matching scopes */
  readonly matchingScopes: readonly string[];
  /** Unmet constraints */
  readonly unmetConstraints: readonly string[];
  /** Reason for denial (if unauthorized) */
  readonly reason?: string;
}

/**
 * Authority requirement for an action
 */
export interface AuthorityRequirement {
  /** Scope pattern (supports wildcards) */
  readonly scope: string;
  /** Minimum required level */
  readonly minLevel: AuthorityLevelValue;
  /** Additional constraints */
  readonly constraints?: readonly AuthorityConstraint[];
}

/**
 * Parse an authority string into scope and level
 * Format: "scope:level" e.g., "financial:transactions:execute"
 */
export function parseAuthorityString(authority: string): AuthorityScope | null {
  const parts = authority.split(':');
  if (parts.length < 2) {
    return null;
  }

  const levelStr = parts[parts.length - 1];
  const scope = parts.slice(0, -1).join(':');

  const levelMap: Record<string, AuthorityLevelValue> = {
    none: AuthorityLevel.NONE,
    read: AuthorityLevel.READ,
    propose: AuthorityLevel.PROPOSE,
    execute: AuthorityLevel.EXECUTE,
    approve: AuthorityLevel.APPROVE,
    admin: AuthorityLevel.ADMIN,
  };

  const level = levelStr ? levelMap[levelStr.toLowerCase()] : undefined;
  if (level === undefined) {
    return null;
  }

  return { scope, level };
}

/**
 * Check if a scope pattern matches a target scope
 * Supports wildcards: "*" matches any segment
 */
export function scopeMatches(pattern: string, target: string): boolean {
  const patternParts = pattern.split(':');
  const targetParts = target.split(':');

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];

    // Wildcard matches anything
    if (patternPart === '*') {
      // If this is the last pattern part with *, it matches everything remaining
      if (i === patternParts.length - 1) {
        return true;
      }
      continue;
    }

    const targetPart = targetParts[i];
    if (patternPart !== targetPart) {
      return false;
    }
  }

  return patternParts.length <= targetParts.length;
}

/**
 * Authority Checker
 *
 * Evaluates whether an actor has sufficient authority for an action.
 */
export class AuthorityChecker {
  private grants: Map<ContentAddress, AuthorityGrant[]> = new Map();

  /**
   * Grant authority to an actor
   */
  async grant(
    actorId: ContentAddress,
    scopes: readonly AuthorityScope[],
    grantedBy: ContentAddress,
    options?: {
      expiresAt?: string;
      reason?: string;
    }
  ): Promise<AuthorityGrant> {
    const grant: AuthorityGrant = {
      actorId,
      scopes,
      grantedBy,
      grantedAt: new Date().toISOString(),
      ...(options?.expiresAt !== undefined && { expiresAt: options.expiresAt }),
      ...(options?.reason !== undefined && { reason: options.reason }),
    };

    const existing = this.grants.get(actorId) ?? [];
    existing.push(grant);
    this.grants.set(actorId, existing);

    return grant;
  }

  /**
   * Revoke all authority grants for an actor
   */
  async revokeAll(actorId: ContentAddress): Promise<void> {
    this.grants.delete(actorId);
  }

  /**
   * Get effective authority level for an actor on a scope
   */
  getEffectiveLevel(actor: Actor, targetScope: string): AuthorityLevelValue {
    // Parse actor's built-in authorities
    let maxLevel: AuthorityLevelValue = AuthorityLevel.NONE;

    for (const authStr of actor.authorities) {
      const parsed = parseAuthorityString(authStr);
      if (parsed && scopeMatches(parsed.scope, targetScope)) {
        maxLevel = Math.max(maxLevel, parsed.level) as AuthorityLevelValue;
      }
    }

    // Check grants
    const grants = this.grants.get(actor.id) ?? [];
    const now = new Date().toISOString();

    for (const grant of grants) {
      // Check expiry
      if (grant.expiresAt && grant.expiresAt < now) {
        continue;
      }

      for (const scope of grant.scopes) {
        if (scopeMatches(scope.scope, targetScope)) {
          maxLevel = Math.max(maxLevel, scope.level) as AuthorityLevelValue;
        }
      }
    }

    return maxLevel;
  }

  /**
   * Check if an actor has required authority
   */
  async check(
    actor: Actor,
    requirement: AuthorityRequirement,
    context?: Record<string, unknown>
  ): Promise<AuthorityCheckResult> {
    const actualLevel = this.getEffectiveLevel(actor, requirement.scope);
    const authorized = actualLevel >= requirement.minLevel;

    // Find matching scopes
    const matchingScopes: string[] = [];
    for (const authStr of actor.authorities) {
      const parsed = parseAuthorityString(authStr);
      if (parsed && scopeMatches(parsed.scope, requirement.scope)) {
        matchingScopes.push(parsed.scope);
      }
    }

    // Check constraints
    const unmetConstraints: string[] = [];
    if (authorized && requirement.constraints) {
      for (const constraint of requirement.constraints) {
        const met = this.evaluateConstraint(constraint, context);
        if (!met) {
          unmetConstraints.push(constraint.type);
        }
      }
    }

    const fullyAuthorized = authorized && unmetConstraints.length === 0;

    const baseResult = {
      authorized: fullyAuthorized,
      requiredLevel: requirement.minLevel,
      actualLevel,
      matchingScopes,
      unmetConstraints,
    };

    if (!fullyAuthorized) {
      const reason = !authorized
        ? `Insufficient authority: requires ${this.levelName(requirement.minLevel)}, has ${this.levelName(actualLevel)}`
        : `Unmet constraints: ${unmetConstraints.join(', ')}`;
      return { ...baseResult, reason };
    }

    return baseResult;
  }

  /**
   * Check authority for a policy scope
   */
  async checkForPolicy(actor: Actor, policy: PolicyDefinition): Promise<AuthorityCheckResult> {
    // Policies with ESCALATE enforcement require APPROVE level
    // Policies with BLOCK enforcement require EXECUTE level
    const minLevel =
      policy.enforcement === 'ESCALATE' ? AuthorityLevel.APPROVE : AuthorityLevel.EXECUTE;

    return this.check(actor, {
      scope: policy.scope.type === 'GLOBAL' ? '*' : (policy.scope.pattern ?? '*'),
      minLevel,
    });
  }

  /**
   * Get all grants for an actor
   */
  getGrants(actorId: ContentAddress): readonly AuthorityGrant[] {
    return this.grants.get(actorId) ?? [];
  }

  /**
   * Evaluate a constraint
   */
  private evaluateConstraint(
    constraint: AuthorityConstraint,
    context?: Record<string, unknown>
  ): boolean {
    if (!context) {
      return true; // No context to check against
    }

    switch (constraint.type) {
      case 'amount_limit': {
        const limit = constraint.parameters['max'] as number;
        const amount = context['amount'] as number | undefined;
        return amount === undefined || amount <= limit;
      }
      case 'time_window': {
        const start = constraint.parameters['start'] as string;
        const end = constraint.parameters['end'] as string;
        const now = new Date().toISOString();
        return now >= start && now <= end;
      }
      case 'rate_limit': {
        // Would need rate tracking - simplified for now
        return true;
      }
      case 'require_mfa': {
        return context['mfa_verified'] === true;
      }
      default:
        return true;
    }
  }

  /**
   * Get human-readable level name
   */
  private levelName(level: AuthorityLevelValue): string {
    const names: Record<AuthorityLevelValue, string> = {
      [AuthorityLevel.NONE]: 'NONE',
      [AuthorityLevel.READ]: 'READ',
      [AuthorityLevel.PROPOSE]: 'PROPOSE',
      [AuthorityLevel.EXECUTE]: 'EXECUTE',
      [AuthorityLevel.APPROVE]: 'APPROVE',
      [AuthorityLevel.ADMIN]: 'ADMIN',
    };
    return names[level];
  }
}

/**
 * Create an authority checker
 */
export function createAuthorityChecker(): AuthorityChecker {
  return new AuthorityChecker();
}

/**
 * Helper to create an authority string
 */
export function createAuthority(scope: string, level: keyof typeof AuthorityLevel): string {
  return `${scope}:${level.toLowerCase()}`;
}

/**
 * Common authority patterns
 */
export const CommonAuthorities = {
  /** Read all data */
  READ_ALL: 'data:*:read',
  /** Execute financial transactions */
  FINANCIAL_EXECUTE: 'financial:transactions:execute',
  /** Approve financial transactions */
  FINANCIAL_APPROVE: 'financial:transactions:approve',
  /** Admin access */
  ADMIN: '*:admin',
  /** Agent execution */
  AGENT_EXECUTE: 'agent:*:execute',
  /** Policy management */
  POLICY_ADMIN: 'policy:*:admin',
} as const;
