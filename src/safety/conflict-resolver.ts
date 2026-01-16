/**
 * Policy Conflict Resolver for ContextGraph OS
 *
 * Implements EPIC 9 Capability 9.2:
 * T9.2.1 Detect conflicting policies
 * T9.2.2 Provide resolution mechanisms
 *
 * Policies should be consistent. When they're not, we fix it.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { PolicyDefinition, EnforcementAction } from '../policy/schema.js';
import type { DecisionAction } from '../decision/lifecycle.js';
import { computeContentAddress } from '../core/identity/content-address.js';

/**
 * Conflict type
 */
export const ConflictType = {
  /** Direct contradiction (one allows, one denies) */
  CONTRADICTION: 'CONTRADICTION',
  /** Overlapping scope with different enforcement */
  OVERLAP: 'OVERLAP',
  /** Circular dependency between policies */
  CIRCULAR: 'CIRCULAR',
  /** Ambiguous priority */
  AMBIGUOUS_PRIORITY: 'AMBIGUOUS_PRIORITY',
  /** Resource contention */
  RESOURCE_CONTENTION: 'RESOURCE_CONTENTION',
} as const;

export type ConflictTypeValue = (typeof ConflictType)[keyof typeof ConflictType];

/**
 * Resolution strategy
 */
export const ResolutionStrategy = {
  /** More specific policy wins */
  MOST_SPECIFIC: 'MOST_SPECIFIC',
  /** Most restrictive policy wins */
  MOST_RESTRICTIVE: 'MOST_RESTRICTIVE',
  /** Most permissive policy wins */
  MOST_PERMISSIVE: 'MOST_PERMISSIVE',
  /** Higher priority wins */
  PRIORITY: 'PRIORITY',
  /** Newest policy wins */
  NEWEST: 'NEWEST',
  /** Escalate to human */
  ESCALATE: 'ESCALATE',
  /** Custom resolution function */
  CUSTOM: 'CUSTOM',
} as const;

export type ResolutionStrategyValue = (typeof ResolutionStrategy)[keyof typeof ResolutionStrategy];

/**
 * Policy conflict
 */
export interface PolicyConflict {
  /** Conflict ID */
  readonly id: ContentAddress;
  /** Type of conflict */
  readonly type: ConflictTypeValue;
  /** Policies involved */
  readonly policies: readonly PolicyDefinition[];
  /** Scope where conflict occurs */
  readonly scope: string;
  /** Description of the conflict */
  readonly description: string;
  /** Severity (higher = more severe) */
  readonly severity: number;
  /** When the conflict was detected */
  readonly detectedAt: string;
  /** Action that triggered detection (if any) */
  readonly triggeringAction?: DecisionAction;
}

/**
 * Conflict resolution result
 */
export interface ResolutionResult {
  /** Whether the conflict was resolved */
  readonly resolved: boolean;
  /** Strategy used */
  readonly strategy: ResolutionStrategyValue;
  /** Winning policy (if resolved) */
  readonly winningPolicy?: PolicyDefinition;
  /** Explanation of resolution */
  readonly explanation: string;
  /** Recommendation if not resolved */
  readonly recommendation?: string;
  /** Whether escalation is needed */
  readonly needsEscalation: boolean;
}

/**
 * Resolution rule
 */
export interface ResolutionRule {
  /** Rule ID */
  readonly id: string;
  /** Conflict types this rule handles */
  readonly conflictTypes: readonly ConflictTypeValue[];
  /** Strategy to apply */
  readonly strategy: ResolutionStrategyValue;
  /** Priority of this rule */
  readonly priority: number;
  /** Custom resolver function (for CUSTOM strategy) */
  readonly resolver?: (conflict: PolicyConflict) => ResolutionResult;
}

/**
 * Conflict Resolver
 *
 * Detects and resolves policy conflicts.
 */
export class ConflictResolver {
  private policies: Map<ContentAddress, PolicyDefinition> = new Map();
  private rules: ResolutionRule[] = [];
  private conflicts: Map<ContentAddress, PolicyConflict> = new Map();

  constructor() {
    // Register default resolution rules
    this.registerDefaultRules();
  }

  /**
   * Register a policy for conflict detection
   */
  registerPolicy(policy: PolicyDefinition): void {
    this.policies.set(policy.id, policy);
  }

  /**
   * Register a resolution rule
   */
  registerRule(rule: ResolutionRule): void {
    this.rules.push(rule);
    // Sort by priority (higher priority first)
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Detect conflicts between policies
   */
  detectConflicts(scope?: string): readonly PolicyConflict[] {
    const conflicts: PolicyConflict[] = [];
    const policiesArray = Array.from(this.policies.values());

    // Compare each pair of policies
    for (let i = 0; i < policiesArray.length; i++) {
      for (let j = i + 1; j < policiesArray.length; j++) {
        const p1 = policiesArray[i];
        const p2 = policiesArray[j];

        if (!p1 || !p2) continue;

        // Check if scopes overlap
        const overlappingScope = this.findOverlappingScope(p1, p2);
        if (!overlappingScope) continue;

        // Filter by scope if specified
        if (scope && !this.scopeMatches(overlappingScope, scope)) continue;

        // Check for contradiction
        if (this.isContradiction(p1, p2)) {
          conflicts.push(this.createConflict(
            ConflictType.CONTRADICTION,
            [p1, p2],
            overlappingScope,
            `Policies "${p1.name}" and "${p2.name}" have contradictory enforcement actions`
          ));
        }

        // Check for overlap with different enforcement
        if (this.isOverlapConflict(p1, p2)) {
          conflicts.push(this.createConflict(
            ConflictType.OVERLAP,
            [p1, p2],
            overlappingScope,
            `Policies "${p1.name}" and "${p2.name}" overlap with different enforcement levels`
          ));
        }

        // Check for ambiguous priority
        if (this.hasAmbiguousPriority(p1, p2)) {
          conflicts.push(this.createConflict(
            ConflictType.AMBIGUOUS_PRIORITY,
            [p1, p2],
            overlappingScope,
            `Policies "${p1.name}" and "${p2.name}" have the same priority in overlapping scope`
          ));
        }
      }
    }

    // Store conflicts
    for (const conflict of conflicts) {
      this.conflicts.set(conflict.id, conflict);
    }

    return conflicts;
  }

  /**
   * Detect conflicts for a specific action
   */
  detectConflictsForAction(action: DecisionAction): readonly PolicyConflict[] {
    const relevantPolicies = this.findPoliciesForAction(action);

    if (relevantPolicies.length < 2) {
      return [];
    }

    const conflicts: PolicyConflict[] = [];

    for (let i = 0; i < relevantPolicies.length; i++) {
      for (let j = i + 1; j < relevantPolicies.length; j++) {
        const p1 = relevantPolicies[i];
        const p2 = relevantPolicies[j];

        if (!p1 || !p2) continue;

        if (this.isContradiction(p1, p2)) {
          const conflict = this.createConflict(
            ConflictType.CONTRADICTION,
            [p1, p2],
            action.type,
            `Contradictory policies for action "${action.type}"`
          );
          conflicts.push({ ...conflict, triggeringAction: action });
        }
      }
    }

    return conflicts;
  }

  /**
   * Resolve a conflict
   */
  resolve(conflict: PolicyConflict): ResolutionResult {
    // Find applicable rule
    const rule = this.rules.find((r) => r.conflictTypes.includes(conflict.type));

    if (!rule) {
      return {
        resolved: false,
        strategy: ResolutionStrategy.ESCALATE,
        explanation: 'No resolution rule found for this conflict type',
        recommendation: 'Define a resolution rule or manually resolve',
        needsEscalation: true,
      };
    }

    // Apply the rule
    return this.applyRule(rule, conflict);
  }

  /**
   * Resolve all detected conflicts
   */
  resolveAll(): readonly {
    conflict: PolicyConflict;
    resolution: ResolutionResult;
  }[] {
    const results: { conflict: PolicyConflict; resolution: ResolutionResult }[] = [];

    for (const conflict of this.conflicts.values()) {
      const resolution = this.resolve(conflict);
      results.push({ conflict, resolution });
    }

    return results;
  }

  /**
   * Get a conflict by ID
   */
  getConflict(id: ContentAddress): PolicyConflict | undefined {
    return this.conflicts.get(id);
  }

  /**
   * Get all conflicts
   */
  getAllConflicts(): readonly PolicyConflict[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * Check if there are unresolved conflicts
   */
  hasUnresolvedConflicts(): boolean {
    return this.conflicts.size > 0;
  }

  /**
   * Clear detected conflicts
   */
  clearConflicts(): void {
    this.conflicts.clear();
  }

  // Private helper methods

  private registerDefaultRules(): void {
    // Most specific wins for overlaps
    this.registerRule({
      id: 'default-overlap',
      conflictTypes: [ConflictType.OVERLAP],
      strategy: ResolutionStrategy.MOST_SPECIFIC,
      priority: 100,
    });

    // Most restrictive wins for contradictions
    this.registerRule({
      id: 'default-contradiction',
      conflictTypes: [ConflictType.CONTRADICTION],
      strategy: ResolutionStrategy.MOST_RESTRICTIVE,
      priority: 100,
    });

    // Priority-based for ambiguous priority
    this.registerRule({
      id: 'default-ambiguous',
      conflictTypes: [ConflictType.AMBIGUOUS_PRIORITY],
      strategy: ResolutionStrategy.NEWEST,
      priority: 50,
    });

    // Escalate for circular dependencies
    this.registerRule({
      id: 'default-circular',
      conflictTypes: [ConflictType.CIRCULAR],
      strategy: ResolutionStrategy.ESCALATE,
      priority: 100,
    });
  }

  private createConflict(
    type: ConflictTypeValue,
    policies: readonly PolicyDefinition[],
    scope: string,
    description: string
  ): PolicyConflict {
    const conflictData = {
      type,
      policyIds: policies.map((p) => p.id),
      scope,
    };
    const id = computeContentAddress(conflictData);

    const severityMap: Record<ConflictTypeValue, number> = {
      CONTRADICTION: 10,
      OVERLAP: 5,
      CIRCULAR: 8,
      AMBIGUOUS_PRIORITY: 3,
      RESOURCE_CONTENTION: 4,
    };

    return {
      id,
      type,
      policies,
      scope,
      description,
      severity: severityMap[type],
      detectedAt: new Date().toISOString(),
    };
  }

  private findOverlappingScope(p1: PolicyDefinition, p2: PolicyDefinition): string | null {
    const scope1 = p1.scope.pattern ?? '*';
    const scope2 = p2.scope.pattern ?? '*';

    // Check if either is global
    if (p1.scope.type === 'GLOBAL' || p2.scope.type === 'GLOBAL') {
      return '*';
    }

    // Check for direct match
    if (scope1 === scope2) {
      return scope1;
    }

    // Check if one contains the other
    if (this.scopeMatches(scope1, scope2)) {
      return scope2;
    }
    if (this.scopeMatches(scope2, scope1)) {
      return scope1;
    }

    return null;
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

  private isContradiction(p1: PolicyDefinition, p2: PolicyDefinition): boolean {
    // BLOCK vs ALLOW/ANNOTATE
    const restrictive: EnforcementAction[] = ['BLOCK', 'ESCALATE'];
    const permissive: EnforcementAction[] = ['ANNOTATE'];

    return (
      (restrictive.includes(p1.enforcement) && permissive.includes(p2.enforcement)) ||
      (permissive.includes(p1.enforcement) && restrictive.includes(p2.enforcement))
    );
  }

  private isOverlapConflict(p1: PolicyDefinition, p2: PolicyDefinition): boolean {
    return p1.enforcement !== p2.enforcement;
  }

  private hasAmbiguousPriority(p1: PolicyDefinition, p2: PolicyDefinition): boolean {
    const priority1 = p1.metadata?.priority ?? 0;
    const priority2 = p2.metadata?.priority ?? 0;
    return priority1 === priority2 && this.isOverlapConflict(p1, p2);
  }

  private findPoliciesForAction(action: DecisionAction): readonly PolicyDefinition[] {
    return Array.from(this.policies.values()).filter((policy) => {
      const scope = policy.scope.pattern ?? '*';
      return this.scopeMatches(scope, action.type);
    });
  }

  private applyRule(rule: ResolutionRule, conflict: PolicyConflict): ResolutionResult {
    if (rule.strategy === ResolutionStrategy.CUSTOM && rule.resolver) {
      return rule.resolver(conflict);
    }

    switch (rule.strategy) {
      case ResolutionStrategy.MOST_SPECIFIC:
        return this.resolveBySpecificity(conflict);

      case ResolutionStrategy.MOST_RESTRICTIVE:
        return this.resolveByRestrictiveness(conflict);

      case ResolutionStrategy.MOST_PERMISSIVE:
        return this.resolveByPermissiveness(conflict);

      case ResolutionStrategy.PRIORITY:
        return this.resolveByPriority(conflict);

      case ResolutionStrategy.NEWEST:
        return this.resolveByNewest(conflict);

      case ResolutionStrategy.ESCALATE:
      default:
        return {
          resolved: false,
          strategy: ResolutionStrategy.ESCALATE,
          explanation: 'Conflict requires human review',
          needsEscalation: true,
        };
    }
  }

  private resolveBySpecificity(conflict: PolicyConflict): ResolutionResult {
    // More specific = longer scope pattern
    const winner = [...conflict.policies].sort((a, b) => {
      const scopeA = a.scope.pattern ?? '*';
      const scopeB = b.scope.pattern ?? '*';
      return scopeB.length - scopeA.length;
    })[0];

    if (!winner) {
      return {
        resolved: false,
        strategy: ResolutionStrategy.MOST_SPECIFIC,
        explanation: 'Could not determine most specific policy',
        needsEscalation: true,
      };
    }

    return {
      resolved: true,
      strategy: ResolutionStrategy.MOST_SPECIFIC,
      winningPolicy: winner,
      explanation: `Policy "${winner.name}" wins as the most specific`,
      needsEscalation: false,
    };
  }

  private resolveByRestrictiveness(conflict: PolicyConflict): ResolutionResult {
    const enforcementOrder: EnforcementAction[] = ['BLOCK', 'ESCALATE', 'ANNOTATE', 'SHADOW'];

    const winner = [...conflict.policies].sort((a, b) => {
      const indexA = enforcementOrder.indexOf(a.enforcement);
      const indexB = enforcementOrder.indexOf(b.enforcement);
      return indexA - indexB;
    })[0];

    if (!winner) {
      return {
        resolved: false,
        strategy: ResolutionStrategy.MOST_RESTRICTIVE,
        explanation: 'Could not determine most restrictive policy',
        needsEscalation: true,
      };
    }

    return {
      resolved: true,
      strategy: ResolutionStrategy.MOST_RESTRICTIVE,
      winningPolicy: winner,
      explanation: `Policy "${winner.name}" wins as the most restrictive`,
      needsEscalation: false,
    };
  }

  private resolveByPermissiveness(conflict: PolicyConflict): ResolutionResult {
    const enforcementOrder: EnforcementAction[] = ['SHADOW', 'ANNOTATE', 'ESCALATE', 'BLOCK'];

    const winner = [...conflict.policies].sort((a, b) => {
      const indexA = enforcementOrder.indexOf(a.enforcement);
      const indexB = enforcementOrder.indexOf(b.enforcement);
      return indexA - indexB;
    })[0];

    if (!winner) {
      return {
        resolved: false,
        strategy: ResolutionStrategy.MOST_PERMISSIVE,
        explanation: 'Could not determine most permissive policy',
        needsEscalation: true,
      };
    }

    return {
      resolved: true,
      strategy: ResolutionStrategy.MOST_PERMISSIVE,
      winningPolicy: winner,
      explanation: `Policy "${winner.name}" wins as the most permissive`,
      needsEscalation: false,
    };
  }

  private resolveByPriority(conflict: PolicyConflict): ResolutionResult {
    const winner = [...conflict.policies].sort((a, b) => {
      const priorityA = (a.metadata?.priority as number) ?? 0;
      const priorityB = (b.metadata?.priority as number) ?? 0;
      return priorityB - priorityA;
    })[0];

    if (!winner) {
      return {
        resolved: false,
        strategy: ResolutionStrategy.PRIORITY,
        explanation: 'Could not determine highest priority policy',
        needsEscalation: true,
      };
    }

    return {
      resolved: true,
      strategy: ResolutionStrategy.PRIORITY,
      winningPolicy: winner,
      explanation: `Policy "${winner.name}" wins by priority`,
      needsEscalation: false,
    };
  }

  private resolveByNewest(conflict: PolicyConflict): ResolutionResult {
    const winner = [...conflict.policies].sort((a, b) => {
      const dateA = (a.metadata?.createdAt as string) ?? '';
      const dateB = (b.metadata?.createdAt as string) ?? '';
      return dateB.localeCompare(dateA);
    })[0];

    if (!winner) {
      return {
        resolved: false,
        strategy: ResolutionStrategy.NEWEST,
        explanation: 'Could not determine newest policy',
        needsEscalation: true,
      };
    }

    return {
      resolved: true,
      strategy: ResolutionStrategy.NEWEST,
      winningPolicy: winner,
      explanation: `Policy "${winner.name}" wins as the newest`,
      needsEscalation: false,
    };
  }
}

/**
 * Create a conflict resolver
 */
export function createConflictResolver(): ConflictResolver {
  return new ConflictResolver();
}
