/**
 * Alternative Decision Tracking for ContextGraph OS
 *
 * Implements EPIC 4 Capability 4.2:
 * T4.2.1 Capture alternatives considered
 * T4.2.2 Store rejection rationale (if available)
 * T4.2.3 Link alternatives to final decision
 *
 * "Why not X?" must always be answerable.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { Decision, DecisionAction } from './lifecycle.js';
import { computeContentAddress } from '../core/identity/content-address.js';

/**
 * Reason why an alternative was not selected
 */
export const RejectionReason = {
  /** Policy violation */
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  /** Insufficient authority */
  INSUFFICIENT_AUTHORITY: 'INSUFFICIENT_AUTHORITY',
  /** Resource constraints */
  RESOURCE_CONSTRAINT: 'RESOURCE_CONSTRAINT',
  /** Better alternative exists */
  BETTER_ALTERNATIVE: 'BETTER_ALTERNATIVE',
  /** Risk too high */
  RISK_TOO_HIGH: 'RISK_TOO_HIGH',
  /** Not feasible */
  NOT_FEASIBLE: 'NOT_FEASIBLE',
  /** User preference */
  USER_PREFERENCE: 'USER_PREFERENCE',
  /** Timing issues */
  TIMING: 'TIMING',
  /** Other */
  OTHER: 'OTHER',
} as const;

export type RejectionReasonValue = (typeof RejectionReason)[keyof typeof RejectionReason];

/**
 * An alternative decision that was considered
 */
export interface Alternative {
  /** Unique ID for this alternative */
  readonly id: ContentAddress;
  /** The proposed action */
  readonly action: DecisionAction;
  /** Why this alternative was considered */
  readonly consideration: string;
  /** Why this alternative was not selected */
  readonly rejection?: AlternativeRejection;
  /** Comparison score (0-100, higher = better) */
  readonly score?: number;
  /** Pros of this alternative */
  readonly pros?: readonly string[];
  /** Cons of this alternative */
  readonly cons?: readonly string[];
  /** When this alternative was identified */
  readonly identifiedAt: Timestamp;
  /** Actor who identified this alternative */
  readonly identifiedBy: ContentAddress;
}

/**
 * Rejection details for an alternative
 */
export interface AlternativeRejection {
  /** Primary reason category */
  readonly reason: RejectionReasonValue;
  /** Detailed explanation */
  readonly explanation: string;
  /** Who made the rejection decision */
  readonly rejectedBy: ContentAddress;
  /** When it was rejected */
  readonly rejectedAt: Timestamp;
  /** Supporting evidence or references */
  readonly evidence?: readonly ContentAddress[];
}

/**
 * Comparison between selected decision and alternatives
 */
export interface DecisionComparison {
  /** The selected decision */
  readonly selected: Decision;
  /** All alternatives that were considered */
  readonly alternatives: readonly Alternative[];
  /** Why the selected option was chosen */
  readonly selectionRationale: string;
  /** Key factors in the decision */
  readonly decisionFactors: readonly DecisionFactor[];
  /** When the comparison was made */
  readonly comparedAt: Timestamp;
}

/**
 * A factor that influenced the decision
 */
export interface DecisionFactor {
  /** Factor name */
  readonly name: string;
  /** Factor weight (0-1) */
  readonly weight: number;
  /** How the selected decision scored on this factor */
  readonly selectedScore: number;
  /** How alternatives scored (keyed by alternative ID) */
  readonly alternativeScores: Record<ContentAddress, number>;
}

/**
 * Input for registering a new alternative
 */
export interface RegisterAlternativeInput {
  /** The proposed action */
  readonly action: DecisionAction;
  /** Why this alternative was considered */
  readonly consideration: string;
  /** Actor identifying the alternative */
  readonly identifiedBy: ContentAddress;
  /** Optional pros */
  readonly pros?: readonly string[];
  /** Optional cons */
  readonly cons?: readonly string[];
  /** Initial score (if calculated) */
  readonly score?: number;
}

/**
 * Alternative Decision Tracker
 *
 * Manages the tracking of alternatives considered during decision-making.
 */
export class AlternativeTracker {
  private alternatives: Map<ContentAddress, Alternative> = new Map();
  private decisionAlternatives: Map<ContentAddress, Set<ContentAddress>> = new Map();

  /**
   * Register a new alternative for consideration
   */
  async register(input: RegisterAlternativeInput): Promise<Alternative> {
    const identifiedAt = new Date().toISOString();

    const altData = {
      action: input.action,
      consideration: input.consideration,
      identifiedBy: input.identifiedBy,
      identifiedAt,
    };

    const id = computeContentAddress(altData);

    const baseAlternative = {
      id,
      action: input.action,
      consideration: input.consideration,
      identifiedAt,
      identifiedBy: input.identifiedBy,
    };

    const alternative: Alternative = {
      ...baseAlternative,
      ...(input.score !== undefined && { score: input.score }),
      ...(input.pros !== undefined && { pros: input.pros }),
      ...(input.cons !== undefined && { cons: input.cons }),
    };

    this.alternatives.set(id, alternative);
    return alternative;
  }

  /**
   * Link alternatives to a decision
   */
  async linkToDecision(
    decisionId: ContentAddress,
    alternativeIds: readonly ContentAddress[]
  ): Promise<void> {
    const existing = this.decisionAlternatives.get(decisionId) ?? new Set();
    for (const altId of alternativeIds) {
      if (!this.alternatives.has(altId)) {
        throw new Error(`Alternative not found: ${altId}`);
      }
      existing.add(altId);
    }
    this.decisionAlternatives.set(decisionId, existing);
  }

  /**
   * Record why an alternative was rejected
   */
  async reject(
    alternativeId: ContentAddress,
    reason: RejectionReasonValue,
    explanation: string,
    rejectedBy: ContentAddress,
    evidence?: readonly ContentAddress[]
  ): Promise<Alternative> {
    const alternative = this.alternatives.get(alternativeId);
    if (!alternative) {
      throw new Error(`Alternative not found: ${alternativeId}`);
    }

    const rejection: AlternativeRejection = evidence !== undefined
      ? {
          reason,
          explanation,
          rejectedBy,
          rejectedAt: new Date().toISOString(),
          evidence,
        }
      : {
          reason,
          explanation,
          rejectedBy,
          rejectedAt: new Date().toISOString(),
        };

    const rejectedAlternative: Alternative = {
      ...alternative,
      rejection,
    };

    this.alternatives.set(alternativeId, rejectedAlternative);
    return rejectedAlternative;
  }

  /**
   * Get all alternatives for a decision
   */
  async getAlternatives(decisionId: ContentAddress): Promise<readonly Alternative[]> {
    const altIds = this.decisionAlternatives.get(decisionId);
    if (!altIds) {
      return [];
    }

    return Array.from(altIds)
      .map((id) => this.alternatives.get(id))
      .filter((alt): alt is Alternative => alt !== undefined);
  }

  /**
   * Get an alternative by ID
   */
  getAlternative(id: ContentAddress): Alternative | undefined {
    return this.alternatives.get(id);
  }

  /**
   * Generate a comparison between selected decision and alternatives
   */
  async compare(
    selectedDecision: Decision,
    selectionRationale: string,
    factors?: readonly DecisionFactor[]
  ): Promise<DecisionComparison> {
    const alternatives = await this.getAlternatives(selectedDecision.id);

    return {
      selected: selectedDecision,
      alternatives,
      selectionRationale,
      decisionFactors: factors ?? [],
      comparedAt: new Date().toISOString(),
    };
  }

  /**
   * Answer "Why not X?"
   */
  async whyNot(alternativeId: ContentAddress): Promise<{
    alternative: Alternative;
    answer: string;
  } | null> {
    const alternative = this.alternatives.get(alternativeId);
    if (!alternative) {
      return null;
    }

    let answer: string;
    if (alternative.rejection) {
      answer = `${alternative.rejection.reason}: ${alternative.rejection.explanation}`;
    } else {
      answer = 'This alternative is still under consideration';
    }

    return { alternative, answer };
  }

  /**
   * Get rejection statistics
   */
  getRejectionStats(): Record<RejectionReasonValue, number> {
    const stats: Record<string, number> = {};

    for (const alt of this.alternatives.values()) {
      if (alt.rejection) {
        stats[alt.rejection.reason] = (stats[alt.rejection.reason] ?? 0) + 1;
      }
    }

    return stats as Record<RejectionReasonValue, number>;
  }
}

/**
 * Create an alternative tracker
 */
export function createAlternativeTracker(): AlternativeTracker {
  return new AlternativeTracker();
}

/**
 * Helper to format rejection reason for display
 */
export function formatRejectionReason(reason: RejectionReasonValue): string {
  const labels: Record<RejectionReasonValue, string> = {
    POLICY_VIOLATION: 'Policy Violation',
    INSUFFICIENT_AUTHORITY: 'Insufficient Authority',
    RESOURCE_CONSTRAINT: 'Resource Constraint',
    BETTER_ALTERNATIVE: 'Better Alternative Exists',
    RISK_TOO_HIGH: 'Risk Too High',
    NOT_FEASIBLE: 'Not Feasible',
    USER_PREFERENCE: 'User Preference',
    TIMING: 'Timing Issues',
    OTHER: 'Other',
  };
  return labels[reason];
}
