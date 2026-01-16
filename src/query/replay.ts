/**
 * Decision Replay Engine for ContextGraph OS
 *
 * Implements EPIC 7 Capability 7.2:
 * T7.2.1 Replay decision from historical context
 * T7.2.2 Compare with current outcome
 *
 * History doesn't repeat, but it does rhyme.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { Decision, DecisionAction } from '../decision/lifecycle.js';
import type { DecisionVerdict, VerdictResult } from '../policy/evaluator.js';
import type { PolicyDefinition } from '../policy/schema.js';
import { computeContentAddress } from '../core/identity/content-address.js';

/**
 * Replay mode
 */
export const ReplayMode = {
  /** Exact replay with original context and policies */
  EXACT: 'EXACT',
  /** Replay with current policies */
  CURRENT_POLICIES: 'CURRENT_POLICIES',
  /** Replay with modified context */
  MODIFIED_CONTEXT: 'MODIFIED_CONTEXT',
  /** What-if analysis with hypothetical changes */
  WHAT_IF: 'WHAT_IF',
} as const;

export type ReplayModeValue = (typeof ReplayMode)[keyof typeof ReplayMode];

/**
 * Replay request
 */
export interface ReplayRequest {
  /** Original decision to replay */
  readonly originalDecisionId: ContentAddress;
  /** Replay mode */
  readonly mode: ReplayModeValue;
  /** Point in time to replay from (for exact mode) */
  readonly asOfTime?: Timestamp;
  /** Modified context (for modified context mode) */
  readonly modifiedContext?: Record<string, unknown>;
  /** Hypothetical changes (for what-if mode) */
  readonly whatIfChanges?: WhatIfChange[];
}

/**
 * What-if change specification
 */
export interface WhatIfChange {
  /** Type of change */
  readonly type: 'add_policy' | 'remove_policy' | 'modify_context' | 'change_actor';
  /** Target of change */
  readonly target: ContentAddress | string;
  /** New value (for add/modify) */
  readonly newValue?: unknown;
}

/**
 * Replay result
 */
export interface ReplayResult {
  /** Replay request ID */
  readonly id: ContentAddress;
  /** Original decision */
  readonly originalDecision: Decision;
  /** Original verdict */
  readonly originalVerdict: DecisionVerdict;
  /** Replayed verdict */
  readonly replayedVerdict: DecisionVerdict;
  /** Comparison of outcomes */
  readonly comparison: ReplayComparison;
  /** When replay was executed */
  readonly replayedAt: Timestamp;
  /** Replay mode used */
  readonly mode: ReplayModeValue;
  /** Changes applied (if any) */
  readonly changesApplied?: readonly string[];
}

/**
 * Comparison between original and replayed outcomes
 */
export interface ReplayComparison {
  /** Whether the outcome changed */
  readonly outcomeChanged: boolean;
  /** Original result */
  readonly originalResult: VerdictResult;
  /** Replayed result */
  readonly replayedResult: VerdictResult;
  /** Differences in violations */
  readonly violationDiff: ViolationDiff;
  /** Summary of differences */
  readonly summary: string;
  /** Risk assessment of the change */
  readonly riskAssessment: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/**
 * Difference in violations
 */
export interface ViolationDiff {
  /** Violations that were added */
  readonly added: readonly ViolationSummary[];
  /** Violations that were removed */
  readonly removed: readonly ViolationSummary[];
  /** Violations that remained the same */
  readonly unchanged: readonly ViolationSummary[];
}

/**
 * Summary of a violation for comparison
 */
export interface ViolationSummary {
  /** Policy ID */
  readonly policyId: ContentAddress;
  /** Violation message */
  readonly message: string;
  /** Severity */
  readonly severity: string;
}

/**
 * Historical snapshot for replay
 */
export interface HistoricalSnapshot {
  /** Snapshot timestamp */
  readonly asOfTime: Timestamp;
  /** Decision at that time */
  readonly decision: Decision;
  /** Verdict at that time */
  readonly verdict: DecisionVerdict;
  /** Policies active at that time */
  readonly activePolicies: readonly ContentAddress[];
  /** Context state at that time */
  readonly contextState: Record<string, unknown>;
}

/**
 * Policy evaluator interface for replay
 */
export interface ReplayPolicyEvaluator {
  evaluate(
    action: DecisionAction,
    context: Record<string, unknown>,
    policies: readonly PolicyDefinition[]
  ): DecisionVerdict;
}

/**
 * Decision Replay Engine
 */
export class ReplayEngine {
  private snapshots: Map<ContentAddress, HistoricalSnapshot> = new Map();
  private decisions: Map<ContentAddress, Decision> = new Map();
  private verdicts: Map<ContentAddress, DecisionVerdict> = new Map();
  private policies: Map<ContentAddress, PolicyDefinition> = new Map();
  private policyEvaluator?: ReplayPolicyEvaluator;

  /**
   * Set the policy evaluator for replays
   */
  setPolicyEvaluator(evaluator: ReplayPolicyEvaluator): void {
    this.policyEvaluator = evaluator;
  }

  /**
   * Store a historical snapshot
   */
  storeSnapshot(
    decision: Decision,
    verdict: DecisionVerdict,
    activePolicies: readonly ContentAddress[],
    contextState: Record<string, unknown>
  ): HistoricalSnapshot {
    const asOfTime = decision.concludedAt ?? decision.evaluatedAt ?? decision.proposedAt;

    const snapshot: HistoricalSnapshot = {
      asOfTime,
      decision,
      verdict,
      activePolicies,
      contextState,
    };

    this.snapshots.set(decision.id, snapshot);
    this.decisions.set(decision.id, decision);
    this.verdicts.set(decision.id, verdict);

    return snapshot;
  }

  /**
   * Register a policy for replay
   */
  registerPolicy(policy: PolicyDefinition): void {
    this.policies.set(policy.id, policy);
  }

  /**
   * Replay a decision
   */
  replay(request: ReplayRequest): ReplayResult {
    const snapshot = this.snapshots.get(request.originalDecisionId);
    if (!snapshot) {
      throw new Error(`No snapshot found for decision: ${request.originalDecisionId}`);
    }

    const replayedAt = new Date().toISOString();

    // Determine which policies and context to use based on mode
    const { policies, context } = this.resolveReplayInputs(request, snapshot);

    // Execute replay
    const replayedVerdict = this.executeReplay(snapshot.decision.action, context, policies);

    // Compare outcomes
    const comparison = this.compareOutcomes(snapshot.verdict, replayedVerdict);

    // Build result
    const resultData = {
      originalDecisionId: request.originalDecisionId,
      mode: request.mode,
      replayedAt,
    };
    const id = computeContentAddress(resultData);

    const baseResult = {
      id,
      originalDecision: snapshot.decision,
      originalVerdict: snapshot.verdict,
      replayedVerdict,
      comparison,
      replayedAt,
      mode: request.mode,
    };

    const changesApplied = this.getChangesApplied(request);
    const result: ReplayResult =
      changesApplied.length > 0 ? { ...baseResult, changesApplied } : baseResult;

    return result;
  }

  /**
   * Compare two decisions
   */
  compareDecisions(
    decisionId1: ContentAddress,
    decisionId2: ContentAddress
  ): ReplayComparison | null {
    const verdict1 = this.verdicts.get(decisionId1);
    const verdict2 = this.verdicts.get(decisionId2);

    if (!verdict1 || !verdict2) {
      return null;
    }

    return this.compareOutcomes(verdict1, verdict2);
  }

  /**
   * What-if analysis: what would happen if we changed something?
   */
  whatIf(decisionId: ContentAddress, changes: readonly WhatIfChange[]): ReplayResult {
    return this.replay({
      originalDecisionId: decisionId,
      mode: ReplayMode.WHAT_IF,
      whatIfChanges: [...changes],
    });
  }

  /**
   * Get replay history for a decision
   */
  getReplayHistory(decisionId: ContentAddress): readonly HistoricalSnapshot[] {
    // In a real implementation, this would return multiple snapshots
    const snapshot = this.snapshots.get(decisionId);
    return snapshot ? [snapshot] : [];
  }

  // Private helper methods

  private resolveReplayInputs(
    request: ReplayRequest,
    snapshot: HistoricalSnapshot
  ): {
    policies: readonly PolicyDefinition[];
    context: Record<string, unknown>;
  } {
    let policies: PolicyDefinition[];
    let context: Record<string, unknown>;

    switch (request.mode) {
      case ReplayMode.EXACT:
        // Use original policies and context
        policies = snapshot.activePolicies
          .map((id) => this.policies.get(id))
          .filter((p): p is PolicyDefinition => p !== undefined);
        context = { ...snapshot.contextState };
        break;

      case ReplayMode.CURRENT_POLICIES:
        // Use current policies with original context
        policies = Array.from(this.policies.values());
        context = { ...snapshot.contextState };
        break;

      case ReplayMode.MODIFIED_CONTEXT:
        // Use original policies with modified context
        policies = snapshot.activePolicies
          .map((id) => this.policies.get(id))
          .filter((p): p is PolicyDefinition => p !== undefined);
        context = { ...snapshot.contextState, ...request.modifiedContext };
        break;

      case ReplayMode.WHAT_IF:
        // Apply what-if changes
        policies = this.applyWhatIfChangesToPolicies(
          snapshot.activePolicies,
          request.whatIfChanges ?? []
        );
        context = this.applyWhatIfChangesToContext(
          snapshot.contextState,
          request.whatIfChanges ?? []
        );
        break;

      default:
        policies = [];
        context = {};
    }

    return { policies, context };
  }

  private executeReplay(
    action: DecisionAction,
    context: Record<string, unknown>,
    policies: readonly PolicyDefinition[]
  ): DecisionVerdict {
    if (this.policyEvaluator) {
      return this.policyEvaluator.evaluate(action, context, policies);
    }

    // Default mock verdict if no evaluator is set
    return {
      id: computeContentAddress({ mock: true, timestamp: Date.now() }),
      decisionId: computeContentAddress(action),
      result: 'ALLOW',
      scope: '*',
      policyResults: [],
      blockingPolicies: [],
      escalatingPolicies: [],
      annotations: [],
      violations: [],
      evaluatedAt: new Date().toISOString(),
      evaluationTimeMs: 0,
    };
  }

  private compareOutcomes(original: DecisionVerdict, replayed: DecisionVerdict): ReplayComparison {
    const outcomeChanged = original.result !== replayed.result;

    // Build violation diff
    const originalViolations = new Map(
      original.violations.map((v) => [`${v.policyId}:${v.message}`, v])
    );
    const replayedViolations = new Map(
      replayed.violations.map((v) => [`${v.policyId}:${v.message}`, v])
    );

    const added: ViolationSummary[] = [];
    const removed: ViolationSummary[] = [];
    const unchanged: ViolationSummary[] = [];

    for (const [key, v] of replayedViolations) {
      if (originalViolations.has(key)) {
        unchanged.push({ policyId: v.policyId, message: v.message, severity: v.severity });
      } else {
        added.push({ policyId: v.policyId, message: v.message, severity: v.severity });
      }
    }

    for (const [key, v] of originalViolations) {
      if (!replayedViolations.has(key)) {
        removed.push({ policyId: v.policyId, message: v.message, severity: v.severity });
      }
    }

    const violationDiff: ViolationDiff = { added, removed, unchanged };

    // Generate summary
    const summaryParts: string[] = [];
    if (outcomeChanged) {
      summaryParts.push(`Outcome changed from ${original.result} to ${replayed.result}.`);
    } else {
      summaryParts.push(`Outcome unchanged: ${original.result}.`);
    }

    if (added.length > 0) {
      summaryParts.push(`${added.length} new violation(s) would occur.`);
    }
    if (removed.length > 0) {
      summaryParts.push(`${removed.length} violation(s) would be resolved.`);
    }

    // Assess risk
    const riskAssessment = this.assessReplayRisk(original, replayed, violationDiff);

    return {
      outcomeChanged,
      originalResult: original.result,
      replayedResult: replayed.result,
      violationDiff,
      summary: summaryParts.join(' '),
      riskAssessment,
    };
  }

  private assessReplayRisk(
    original: DecisionVerdict,
    replayed: DecisionVerdict,
    violationDiff: ViolationDiff
  ): 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    // Critical: ALLOW became DENY or vice versa
    if (
      (original.result === 'ALLOW' && replayed.result === 'DENY') ||
      (original.result === 'DENY' && replayed.result === 'ALLOW')
    ) {
      return 'CRITICAL';
    }

    // High: Significant change in violations
    if (violationDiff.added.length > 2 || violationDiff.removed.length > 2) {
      return 'HIGH';
    }

    // Medium: Some changes
    if (violationDiff.added.length > 0 || violationDiff.removed.length > 0) {
      return 'MEDIUM';
    }

    // Low: Outcome changed but no violation changes
    if (original.result !== replayed.result) {
      return 'LOW';
    }

    return 'NONE';
  }

  private applyWhatIfChangesToPolicies(
    originalPolicyIds: readonly ContentAddress[],
    changes: readonly WhatIfChange[]
  ): PolicyDefinition[] {
    const policyIds = new Set(originalPolicyIds);

    for (const change of changes) {
      if (change.type === 'add_policy' && change.newValue) {
        const policy = change.newValue as PolicyDefinition;
        this.policies.set(policy.id, policy);
        policyIds.add(policy.id);
      } else if (change.type === 'remove_policy') {
        policyIds.delete(change.target as ContentAddress);
      }
    }

    return Array.from(policyIds)
      .map((id) => this.policies.get(id))
      .filter((p): p is PolicyDefinition => p !== undefined);
  }

  private applyWhatIfChangesToContext(
    originalContext: Record<string, unknown>,
    changes: readonly WhatIfChange[]
  ): Record<string, unknown> {
    const context = { ...originalContext };

    for (const change of changes) {
      if (change.type === 'modify_context' && typeof change.target === 'string') {
        context[change.target] = change.newValue;
      }
    }

    return context;
  }

  private getChangesApplied(request: ReplayRequest): string[] {
    const changes: string[] = [];

    if (request.mode === ReplayMode.CURRENT_POLICIES) {
      changes.push('Applied current policy set');
    }

    if (request.mode === ReplayMode.MODIFIED_CONTEXT && request.modifiedContext) {
      changes.push(`Modified context: ${Object.keys(request.modifiedContext).join(', ')}`);
    }

    if (request.mode === ReplayMode.WHAT_IF && request.whatIfChanges) {
      for (const change of request.whatIfChanges) {
        changes.push(`${change.type}: ${change.target}`);
      }
    }

    return changes;
  }
}

/**
 * Create a replay engine
 */
export function createReplayEngine(): ReplayEngine {
  return new ReplayEngine();
}
