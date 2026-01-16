/**
 * Escalation Pathways for ContextGraph OS
 *
 * Implements EPIC 6 Capability 6.2:
 * T6.2.1 Define escalation conditions
 * T6.2.2 Route to appropriate authority
 * T6.2.3 Timeout handling
 *
 * When in doubt, escalate. Silence is not consent.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { Decision } from '../decision/lifecycle.js';
import type { DecisionVerdict } from '../policy/evaluator.js';
import type { AuthorityLevelValue } from '../actor/authority.js';
import type {
  ApprovalRequest,
  ApprovalContext,
  ApprovalPriorityValue,
  ApprovalQueue,
} from './approval.js';
import { ApprovalPriority, createApprovalQueue } from './approval.js';
import { computeContentAddress } from '../core/identity/content-address.js';

/**
 * Escalation trigger types
 */
export const EscalationTrigger = {
  /** Policy evaluation resulted in ESCALATE */
  POLICY_ESCALATE: 'POLICY_ESCALATE',
  /** Risk threshold exceeded */
  RISK_THRESHOLD: 'RISK_THRESHOLD',
  /** Unusual pattern detected */
  ANOMALY_DETECTED: 'ANOMALY_DETECTED',
  /** Authority level insufficient */
  AUTHORITY_INSUFFICIENT: 'AUTHORITY_INSUFFICIENT',
  /** Manual escalation requested */
  MANUAL_REQUEST: 'MANUAL_REQUEST',
  /** Conflict between policies */
  POLICY_CONFLICT: 'POLICY_CONFLICT',
  /** Time-sensitive decision */
  TIME_SENSITIVE: 'TIME_SENSITIVE',
} as const;

export type EscalationTriggerValue = (typeof EscalationTrigger)[keyof typeof EscalationTrigger];

/**
 * Escalation level
 */
export const EscalationLevel = {
  /** First level - immediate supervisor */
  L1: 1,
  /** Second level - department head */
  L2: 2,
  /** Third level - executive */
  L3: 3,
  /** Fourth level - board/emergency */
  L4: 4,
} as const;

export type EscalationLevelValue = (typeof EscalationLevel)[keyof typeof EscalationLevel];

/**
 * Escalation rule definition
 */
export interface EscalationRule {
  /** Unique rule ID */
  readonly id: ContentAddress;
  /** Rule name */
  readonly name: string;
  /** Trigger condition */
  readonly trigger: EscalationTriggerValue;
  /** Conditions that must be met */
  readonly conditions: readonly EscalationCondition[];
  /** Target escalation level */
  readonly targetLevel: EscalationLevelValue;
  /** Priority for resulting approval request */
  readonly priority: ApprovalPriorityValue;
  /** Timeout in milliseconds */
  readonly timeoutMs: number;
  /** Whether to auto-reject on timeout */
  readonly autoRejectOnTimeout: boolean;
  /** Active status */
  readonly active: boolean;
}

/**
 * Escalation condition
 */
export interface EscalationCondition {
  /** Condition type */
  readonly type: 'scope_pattern' | 'risk_level' | 'amount_threshold' | 'actor_type' | 'custom';
  /** Operator */
  readonly operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'matches';
  /** Value to compare against */
  readonly value: string | number | boolean;
  /** Field to evaluate (for custom conditions) */
  readonly field?: string;
}

/**
 * Escalation path definition
 */
export interface EscalationPath {
  /** Path ID */
  readonly id: ContentAddress;
  /** Scope pattern this path applies to */
  readonly scopePattern: string;
  /** Ordered list of escalation levels */
  readonly levels: readonly EscalationPathLevel[];
  /** Default timeout between levels (ms) */
  readonly defaultTimeoutMs: number;
}

/**
 * A level in an escalation path
 */
export interface EscalationPathLevel {
  /** Escalation level */
  readonly level: EscalationLevelValue;
  /** Approvers at this level (actor IDs or role patterns) */
  readonly approvers: readonly string[];
  /** Minimum authority required */
  readonly minAuthority: AuthorityLevelValue;
  /** Timeout before escalating to next level (ms) */
  readonly timeoutMs?: number;
  /** Number of approvals required */
  readonly requiredApprovals: number;
}

/**
 * Escalation record
 */
export interface EscalationRecord {
  /** Record ID */
  readonly id: ContentAddress;
  /** Decision being escalated */
  readonly decisionId: ContentAddress;
  /** Trigger that caused escalation */
  readonly trigger: EscalationTriggerValue;
  /** Rule that matched (if any) */
  readonly ruleId?: ContentAddress;
  /** Current escalation level */
  readonly currentLevel: EscalationLevelValue;
  /** Path being followed */
  readonly pathId: ContentAddress;
  /** History of escalations */
  readonly history: readonly EscalationEvent[];
  /** When escalation started */
  readonly startedAt: Timestamp;
  /** Associated approval request */
  readonly approvalRequestId?: ContentAddress;
}

/**
 * Escalation event in history
 */
export interface EscalationEvent {
  /** Event type */
  readonly type: 'started' | 'escalated' | 'resolved' | 'timed_out';
  /** Level at time of event */
  readonly level: EscalationLevelValue;
  /** When the event occurred */
  readonly timestamp: Timestamp;
  /** Actor involved (if any) */
  readonly actorId?: ContentAddress;
  /** Details */
  readonly details?: string;
}

/**
 * Input for triggering an escalation
 */
export interface TriggerEscalationInput {
  /** Decision to escalate */
  readonly decision: Decision;
  /** Trigger type */
  readonly trigger: EscalationTriggerValue;
  /** Verdict that caused escalation (if from policy) */
  readonly verdict?: DecisionVerdict;
  /** Context for approvers */
  readonly context: ApprovalContext;
  /** Requesting actor */
  readonly requestedBy: ContentAddress;
}

/**
 * Escalation Manager
 *
 * Routes escalated decisions to appropriate authorities.
 */
export class EscalationManager {
  private rules: Map<ContentAddress, EscalationRule> = new Map();
  private paths: Map<ContentAddress, EscalationPath> = new Map();
  private records: Map<ContentAddress, EscalationRecord> = new Map();
  private byDecision: Map<ContentAddress, ContentAddress> = new Map();
  private approvalQueue: ApprovalQueue;

  constructor(approvalQueue?: ApprovalQueue) {
    this.approvalQueue = approvalQueue ?? createApprovalQueue();
  }

  /**
   * Register an escalation rule
   */
  registerRule(
    name: string,
    trigger: EscalationTriggerValue,
    conditions: readonly EscalationCondition[],
    options: {
      targetLevel?: EscalationLevelValue;
      priority?: ApprovalPriorityValue;
      timeoutMs?: number;
      autoRejectOnTimeout?: boolean;
    } = {}
  ): EscalationRule {
    const ruleData = { name, trigger, conditions };
    const id = computeContentAddress(ruleData);

    const rule: EscalationRule = {
      id,
      name,
      trigger,
      conditions,
      targetLevel: options.targetLevel ?? EscalationLevel.L1,
      priority: options.priority ?? ApprovalPriority.NORMAL,
      timeoutMs: options.timeoutMs ?? 24 * 60 * 60 * 1000,
      autoRejectOnTimeout: options.autoRejectOnTimeout ?? true,
      active: true,
    };

    this.rules.set(id, rule);
    return rule;
  }

  /**
   * Register an escalation path
   */
  registerPath(
    scopePattern: string,
    levels: readonly EscalationPathLevel[],
    defaultTimeoutMs: number = 8 * 60 * 60 * 1000
  ): EscalationPath {
    const pathData = { scopePattern, levels };
    const id = computeContentAddress(pathData);

    const path: EscalationPath = {
      id,
      scopePattern,
      levels,
      defaultTimeoutMs,
    };

    this.paths.set(id, path);
    return path;
  }

  /**
   * Find matching escalation path for a scope
   */
  findPath(scope: string): EscalationPath | undefined {
    for (const path of this.paths.values()) {
      if (this.scopeMatches(path.scopePattern, scope)) {
        return path;
      }
    }
    return undefined;
  }

  /**
   * Trigger an escalation
   */
  triggerEscalation(input: TriggerEscalationInput): {
    record: EscalationRecord;
    approvalRequest: ApprovalRequest;
  } {
    // Find matching rule
    const matchingRule = this.findMatchingRule(input.trigger, input.decision, input.verdict);

    // Determine scope and find path
    const scope = input.verdict?.scope ?? '*';
    const path = this.findPath(scope);

    if (!path) {
      throw new Error(`No escalation path found for scope: ${scope}`);
    }

    const startedAt = new Date().toISOString();
    const initialLevel = matchingRule?.targetLevel ?? EscalationLevel.L1;

    // Find approvers for initial level
    const levelConfig = path.levels.find((l) => l.level === initialLevel);
    if (!levelConfig) {
      throw new Error(`No configuration for level ${initialLevel} in path ${path.id}`);
    }

    // Create escalation record
    const recordData = {
      decisionId: input.decision.id,
      trigger: input.trigger,
      pathId: path.id,
      startedAt,
    };
    const recordId = computeContentAddress(recordData);

    const initialEvent: EscalationEvent = {
      type: 'started',
      level: initialLevel,
      timestamp: startedAt,
      actorId: input.requestedBy,
      details: `Escalation triggered: ${input.trigger}`,
    };

    // Create approval request
    const approvalRequest = this.approvalQueue.createRequest({
      decisionId: input.decision.id,
      requestedBy: input.requestedBy,
      reason: `Escalation: ${input.trigger}`,
      priority: matchingRule?.priority ?? ApprovalPriority.NORMAL,
      approvers: levelConfig.approvers as ContentAddress[],
      timeoutMs: levelConfig.timeoutMs ?? path.defaultTimeoutMs,
      context: input.context,
      ...(matchingRule !== undefined && { triggeringPolicyId: matchingRule.id }),
    });

    const baseRecord = {
      id: recordId,
      decisionId: input.decision.id,
      trigger: input.trigger,
      currentLevel: initialLevel,
      pathId: path.id,
      history: [initialEvent],
      startedAt,
      approvalRequestId: approvalRequest.id,
    };

    const record: EscalationRecord =
      matchingRule !== undefined ? { ...baseRecord, ruleId: matchingRule.id } : baseRecord;

    this.records.set(recordId, record);
    this.byDecision.set(input.decision.id, recordId);

    return { record, approvalRequest };
  }

  /**
   * Escalate to next level
   */
  escalateToNextLevel(
    recordId: ContentAddress,
    reason: string,
    requestedBy: ContentAddress
  ): {
    record: EscalationRecord;
    approvalRequest: ApprovalRequest;
  } | null {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error(`Escalation record not found: ${recordId}`);
    }

    const path = this.paths.get(record.pathId);
    if (!path) {
      throw new Error(`Escalation path not found: ${record.pathId}`);
    }

    // Find next level
    const currentLevelIndex = path.levels.findIndex((l) => l.level === record.currentLevel);
    if (currentLevelIndex === -1 || currentLevelIndex === path.levels.length - 1) {
      // Already at highest level
      return null;
    }

    const nextLevelConfig = path.levels[currentLevelIndex + 1];
    if (!nextLevelConfig) {
      return null;
    }

    const timestamp = new Date().toISOString();

    const escalationEvent: EscalationEvent = {
      type: 'escalated',
      level: nextLevelConfig.level,
      timestamp,
      actorId: requestedBy,
      details: reason,
    };

    // Create new approval request for next level
    const approvalRequest = this.approvalQueue.createRequest({
      decisionId: record.decisionId,
      requestedBy,
      reason: `Escalated from L${record.currentLevel} to L${nextLevelConfig.level}: ${reason}`,
      priority: ApprovalPriority.HIGH,
      approvers: nextLevelConfig.approvers as ContentAddress[],
      timeoutMs: nextLevelConfig.timeoutMs ?? path.defaultTimeoutMs,
      context: {
        summary: `Escalated decision requiring L${nextLevelConfig.level} approval`,
        riskLevel: 'HIGH',
        impact: reason,
      },
    });

    const updatedRecord: EscalationRecord = {
      ...record,
      currentLevel: nextLevelConfig.level,
      history: [...record.history, escalationEvent],
      approvalRequestId: approvalRequest.id,
    };

    this.records.set(recordId, updatedRecord);

    return { record: updatedRecord, approvalRequest };
  }

  /**
   * Resolve an escalation
   */
  resolveEscalation(
    recordId: ContentAddress,
    outcome: 'approved' | 'rejected',
    resolvedBy: ContentAddress,
    details?: string
  ): EscalationRecord {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error(`Escalation record not found: ${recordId}`);
    }

    const timestamp = new Date().toISOString();

    const resolveEvent: EscalationEvent = {
      type: 'resolved',
      level: record.currentLevel,
      timestamp,
      actorId: resolvedBy,
      details: details ?? `Escalation ${outcome}`,
    };

    const updatedRecord: EscalationRecord = {
      ...record,
      history: [...record.history, resolveEvent],
    };

    this.records.set(recordId, updatedRecord);
    return updatedRecord;
  }

  /**
   * Process timeouts and escalate as needed
   */
  processTimeouts(): readonly EscalationRecord[] {
    const timedOutApprovals = this.approvalQueue.processTimeouts('reject');
    const escalatedRecords: EscalationRecord[] = [];

    for (const approval of timedOutApprovals) {
      const recordId = this.byDecision.get(approval.decisionId);
      if (!recordId) {
        continue;
      }

      const record = this.records.get(recordId);
      if (!record) {
        continue;
      }

      const timestamp = new Date().toISOString();

      const timeoutEvent: EscalationEvent = {
        type: 'timed_out',
        level: record.currentLevel,
        timestamp,
        details: 'Approval request timed out',
      };

      const updatedRecord: EscalationRecord = {
        ...record,
        history: [...record.history, timeoutEvent],
      };

      this.records.set(recordId, updatedRecord);
      escalatedRecords.push(updatedRecord);
    }

    return escalatedRecords;
  }

  /**
   * Get escalation record for a decision
   */
  getRecordForDecision(decisionId: ContentAddress): EscalationRecord | undefined {
    const recordId = this.byDecision.get(decisionId);
    return recordId ? this.records.get(recordId) : undefined;
  }

  /**
   * Get the approval queue
   */
  getApprovalQueue(): ApprovalQueue {
    return this.approvalQueue;
  }

  /**
   * Find matching rule for a trigger
   */
  private findMatchingRule(
    trigger: EscalationTriggerValue,
    decision: Decision,
    verdict?: DecisionVerdict
  ): EscalationRule | undefined {
    for (const rule of this.rules.values()) {
      if (!rule.active || rule.trigger !== trigger) {
        continue;
      }

      if (this.evaluateConditions(rule.conditions, decision, verdict)) {
        return rule;
      }
    }
    return undefined;
  }

  /**
   * Evaluate escalation conditions
   */
  private evaluateConditions(
    conditions: readonly EscalationCondition[],
    decision: Decision,
    verdict?: DecisionVerdict
  ): boolean {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, decision, verdict)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    condition: EscalationCondition,
    decision: Decision,
    verdict?: DecisionVerdict
  ): boolean {
    switch (condition.type) {
      case 'scope_pattern':
        return verdict !== undefined && this.scopeMatches(String(condition.value), verdict.scope);

      case 'risk_level':
        // Would need risk assessment integration
        return true;

      case 'amount_threshold': {
        const amount = decision.action.parameters['amount'] as number | undefined;
        if (amount === undefined) {
          return true;
        }
        const threshold = Number(condition.value);
        return condition.operator === 'greater_than' ? amount > threshold : amount < threshold;
      }

      case 'actor_type':
        // Would need actor lookup
        return true;

      default:
        return true;
    }
  }

  /**
   * Check if scope pattern matches target
   */
  private scopeMatches(pattern: string, target: string): boolean {
    if (pattern === '*') {
      return true;
    }

    const patternParts = pattern.split(':');
    const targetParts = target.split(':');

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '*') {
        if (i === patternParts.length - 1) {
          return true;
        }
        continue;
      }
      if (patternParts[i] !== targetParts[i]) {
        return false;
      }
    }

    return patternParts.length <= targetParts.length;
  }
}

/**
 * Create an escalation manager
 */
export function createEscalationManager(approvalQueue?: ApprovalQueue): EscalationManager {
  return new EscalationManager(approvalQueue);
}

/**
 * Helper to format escalation level for display
 */
export function formatEscalationLevel(level: EscalationLevelValue): string {
  const labels: Record<EscalationLevelValue, string> = {
    [EscalationLevel.L1]: 'Level 1 - Supervisor',
    [EscalationLevel.L2]: 'Level 2 - Department',
    [EscalationLevel.L3]: 'Level 3 - Executive',
    [EscalationLevel.L4]: 'Level 4 - Emergency',
  };
  return labels[level];
}
