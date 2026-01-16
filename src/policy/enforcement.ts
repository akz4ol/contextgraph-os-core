/**
 * Policy Enforcement for ContextGraph OS
 *
 * Implements EPIC 3 Capability 3.3:
 * T3.3.1 Implement BLOCK
 * T3.3.2 Implement ANNOTATE
 * T3.3.3 Implement ESCALATE
 * T3.3.4 Implement SHADOW (observe-only)
 *
 * Enforcement modes determine what happens when a policy is violated.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { DecisionVerdict } from './evaluator.js';
import type { EnforcementModeValue } from './schema.js';

/**
 * Enforcement action to take
 */
export interface EnforcementAction {
  /** The action type */
  readonly type: EnforcementModeValue;
  /** Whether the decision can proceed */
  readonly canProceed: boolean;
  /** Reason for the action */
  readonly reason: string;
  /** Required next steps (if any) */
  readonly requiredSteps?: readonly RequiredStep[];
  /** Annotations to attach */
  readonly annotations: readonly string[];
  /** Timestamp of action */
  readonly timestamp: Timestamp;
}

/**
 * A required step before proceeding
 */
export interface RequiredStep {
  /** Type of step */
  readonly type: 'approval' | 'review' | 'acknowledgment' | 'custom';
  /** Who needs to perform this step */
  readonly assignee?: ContentAddress;
  /** Description of what's needed */
  readonly description: string;
  /** Deadline for completion */
  readonly deadline?: Timestamp;
}

/**
 * Escalation request generated when ESCALATE enforcement triggers
 */
export interface EscalationRequest {
  /** Unique ID for this escalation */
  readonly id: ContentAddress;
  /** The decision requiring escalation */
  readonly decisionId: ContentAddress;
  /** Policies that triggered the escalation */
  readonly triggeringPolicies: readonly ContentAddress[];
  /** Actors who can resolve this escalation */
  readonly assignees: readonly ContentAddress[];
  /** Escalation priority */
  readonly priority: 'low' | 'medium' | 'high' | 'critical';
  /** Deadline for resolution */
  readonly deadline?: Timestamp;
  /** Current status */
  readonly status: 'pending' | 'approved' | 'rejected' | 'expired';
  /** Created timestamp */
  readonly createdAt: Timestamp;
}

/**
 * Shadow mode observation record
 */
export interface ShadowObservation {
  /** The decision observed */
  readonly decisionId: ContentAddress;
  /** The policy that would have triggered */
  readonly policyId: ContentAddress;
  /** What enforcement would have occurred */
  readonly wouldHaveEnforced: EnforcementModeValue;
  /** The verdict that was recorded but not enforced */
  readonly verdict: DecisionVerdict;
  /** When this was observed */
  readonly observedAt: Timestamp;
  /** Notes for policy development */
  readonly notes?: string;
}

/**
 * Configuration for enforcement behavior
 */
export interface EnforcementConfig {
  /** Default escalation timeout in hours */
  readonly escalationTimeoutHours?: number;
  /** Default escalation assignees */
  readonly defaultEscalationAssignees?: readonly ContentAddress[];
  /** Whether to log all shadow observations */
  readonly logShadowObservations?: boolean;
  /** Callback for shadow observations */
  readonly onShadowObservation?: (observation: ShadowObservation) => void | Promise<void>;
  /** Callback for escalations */
  readonly onEscalation?: (escalation: EscalationRequest) => void | Promise<void>;
}

/**
 * Policy Enforcer
 *
 * Takes a verdict and determines what enforcement actions to take.
 */
export class PolicyEnforcer {
  private readonly config: EnforcementConfig;
  private shadowObservations: ShadowObservation[] = [];

  constructor(config: EnforcementConfig = {}) {
    this.config = {
      escalationTimeoutHours: 24,
      logShadowObservations: true,
      ...config,
    };
  }

  /**
   * Determine enforcement action from a verdict
   */
  async enforce(verdict: DecisionVerdict): Promise<EnforcementAction> {
    const timestamp = new Date().toISOString();

    switch (verdict.result) {
      case 'DENY':
        return this.handleBlock(verdict, timestamp);
      case 'ANNOTATE':
        return this.handleAnnotate(verdict, timestamp);
      case 'ESCALATE':
        return this.handleEscalate(verdict, timestamp);
      case 'ALLOW':
        return this.handleAllow(verdict, timestamp);
      default:
        // Fail safe
        return this.handleBlock(verdict, timestamp);
    }
  }

  /**
   * Handle BLOCK enforcement
   */
  private handleBlock(verdict: DecisionVerdict, timestamp: Timestamp): EnforcementAction {
    const blockingPolicyNames = verdict.policyResults
      .filter((pr) => verdict.blockingPolicies.includes(pr.policyId))
      .map((pr) => pr.policyName);

    return {
      type: 'BLOCK',
      canProceed: false,
      reason: `Blocked by policies: ${blockingPolicyNames.join(', ')}`,
      annotations: verdict.annotations,
      timestamp,
    };
  }

  /**
   * Handle ANNOTATE enforcement
   */
  private handleAnnotate(verdict: DecisionVerdict, timestamp: Timestamp): EnforcementAction {
    return {
      type: 'ANNOTATE',
      canProceed: true,
      reason: 'Decision allowed with annotations',
      annotations: verdict.annotations,
      timestamp,
    };
  }

  /**
   * Handle ESCALATE enforcement
   */
  private async handleEscalate(
    verdict: DecisionVerdict,
    timestamp: Timestamp
  ): Promise<EnforcementAction> {
    const escalationRequest = this.createEscalationRequest(verdict, timestamp);

    // Notify escalation callback if configured
    if (this.config.onEscalation) {
      await this.config.onEscalation(escalationRequest);
    }

    const escalatingPolicyNames = verdict.policyResults
      .filter((pr) => verdict.escalatingPolicies.includes(pr.policyId))
      .map((pr) => pr.policyName);

    return {
      type: 'ESCALATE',
      canProceed: false,
      reason: `Requires approval due to: ${escalatingPolicyNames.join(', ')}`,
      requiredSteps: escalationRequest.deadline !== undefined
        ? [
            {
              type: 'approval',
              description: `Approval required for decision ${verdict.decisionId}`,
              deadline: escalationRequest.deadline,
            },
          ]
        : [
            {
              type: 'approval',
              description: `Approval required for decision ${verdict.decisionId}`,
            },
          ],
      annotations: [...verdict.annotations, `ESCALATION:${escalationRequest.id}`],
      timestamp,
    };
  }

  /**
   * Handle ALLOW (no enforcement needed)
   */
  private handleAllow(_verdict: DecisionVerdict, timestamp: Timestamp): EnforcementAction {
    return {
      type: 'SHADOW', // Using SHADOW as "no enforcement" indicator
      canProceed: true,
      reason: 'All policies passed',
      annotations: [],
      timestamp,
    };
  }

  /**
   * Record a shadow observation (for policies in SHADOW mode)
   */
  async recordShadowObservation(
    decisionId: ContentAddress,
    policyId: ContentAddress,
    wouldHaveEnforced: EnforcementModeValue,
    verdict: DecisionVerdict,
    notes?: string
  ): Promise<ShadowObservation> {
    const observation: ShadowObservation = notes !== undefined
      ? {
          decisionId,
          policyId,
          wouldHaveEnforced,
          verdict,
          observedAt: new Date().toISOString(),
          notes,
        }
      : {
          decisionId,
          policyId,
          wouldHaveEnforced,
          verdict,
          observedAt: new Date().toISOString(),
        };

    if (this.config.logShadowObservations) {
      this.shadowObservations.push(observation);
    }

    if (this.config.onShadowObservation) {
      await this.config.onShadowObservation(observation);
    }

    return observation;
  }

  /**
   * Get all shadow observations
   */
  getShadowObservations(): readonly ShadowObservation[] {
    return [...this.shadowObservations];
  }

  /**
   * Clear shadow observations
   */
  clearShadowObservations(): void {
    this.shadowObservations = [];
  }

  /**
   * Create an escalation request
   */
  private createEscalationRequest(
    verdict: DecisionVerdict,
    timestamp: Timestamp
  ): EscalationRequest {
    const deadline = this.config.escalationTimeoutHours
      ? new Date(
          Date.now() + this.config.escalationTimeoutHours * 60 * 60 * 1000
        ).toISOString()
      : undefined;

    // Determine priority based on policies
    const priority = this.determinePriority(verdict);

    const baseRequest = {
      id: `escalation:${verdict.decisionId}:${timestamp}` as ContentAddress,
      decisionId: verdict.decisionId,
      triggeringPolicies: verdict.escalatingPolicies,
      assignees: this.config.defaultEscalationAssignees ?? [],
      priority,
      status: 'pending' as const,
      createdAt: timestamp,
    };

    if (deadline !== undefined) {
      return { ...baseRequest, deadline };
    }

    return baseRequest;
  }

  /**
   * Determine escalation priority based on verdict
   */
  private determinePriority(
    verdict: DecisionVerdict
  ): EscalationRequest['priority'] {
    // If any blocking policies also exist, it's critical
    if (verdict.blockingPolicies.length > 0) {
      return 'critical';
    }

    // Multiple escalating policies = high
    if (verdict.escalatingPolicies.length > 2) {
      return 'high';
    }

    // Single escalating policy = medium
    if (verdict.escalatingPolicies.length > 0) {
      return 'medium';
    }

    return 'low';
  }
}

/**
 * Create a policy enforcer
 */
export function createPolicyEnforcer(config?: EnforcementConfig): PolicyEnforcer {
  return new PolicyEnforcer(config);
}

/**
 * Check if an enforcement action allows proceeding
 */
export function canProceed(action: EnforcementAction): boolean {
  return action.canProceed;
}

/**
 * Check if an enforcement action requires approval
 */
export function requiresApproval(action: EnforcementAction): boolean {
  return action.type === 'ESCALATE';
}

/**
 * Check if an enforcement action blocks execution
 */
export function isBlocked(action: EnforcementAction): boolean {
  return action.type === 'BLOCK';
}
