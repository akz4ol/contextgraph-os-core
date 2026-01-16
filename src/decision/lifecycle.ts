/**
 * Decision Transaction Model for ContextGraph OS
 *
 * Implements EPIC 4 Capability 4.1:
 * T4.1.1 Define Decision lifecycle (proposed → evaluated → committed)
 * T4.1.2 Prevent partial commits
 * T4.1.3 Enforce atomicity
 *
 * This is where "thinking" becomes "acting".
 * A decision either fully exists or not at all.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { DecisionPayload } from '../core/types/node.js';
import type { DecisionVerdict } from '../policy/evaluator.js';
import { computeContentAddress } from '../core/identity/content-address.js';

/**
 * Decision lifecycle states
 */
export const DecisionState = {
  /** Decision has been proposed but not yet evaluated */
  PROPOSED: 'PROPOSED',
  /** Decision has been evaluated against policies */
  EVALUATED: 'EVALUATED',
  /** Decision has been committed (irreversible) */
  COMMITTED: 'COMMITTED',
  /** Decision was rejected (terminal state) */
  REJECTED: 'REJECTED',
  /** Decision is pending approval (waiting for human) */
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  /** Decision was cancelled before commitment */
  CANCELLED: 'CANCELLED',
} as const;

export type DecisionStateValue = (typeof DecisionState)[keyof typeof DecisionState];

/**
 * Valid state transitions
 */
export const VALID_TRANSITIONS: Record<DecisionStateValue, readonly DecisionStateValue[]> = {
  PROPOSED: ['EVALUATED', 'CANCELLED'],
  EVALUATED: ['COMMITTED', 'REJECTED', 'PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['COMMITTED', 'REJECTED', 'CANCELLED'],
  COMMITTED: [], // Terminal state - no transitions allowed
  REJECTED: [], // Terminal state
  CANCELLED: [], // Terminal state
};

/**
 * Decision action definition
 */
export interface DecisionAction {
  /** Action type identifier */
  readonly type: string;
  /** Action parameters */
  readonly parameters: Record<string, unknown>;
  /** Target of the action (if applicable) */
  readonly targetId?: ContentAddress;
}

/**
 * Context reference for a decision
 */
export interface DecisionContextRef {
  /** ID of the referenced context node */
  readonly contextId: ContentAddress;
  /** How this context was used */
  readonly usage: 'input' | 'reference' | 'constraint';
  /** Relevance score (0-1) */
  readonly relevance?: number;
}

/**
 * Complete decision record
 */
export interface Decision {
  /** Unique decision ID (content-addressed) */
  readonly id: ContentAddress;
  /** Current lifecycle state */
  readonly state: DecisionStateValue;
  /** The action being decided */
  readonly action: DecisionAction;
  /** Actor proposing the decision */
  readonly proposedBy: ContentAddress;
  /** Contexts referenced by this decision */
  readonly contextRefs: readonly DecisionContextRef[];
  /** Rationale for the decision */
  readonly rationale?: string;
  /** Policy verdict (after evaluation) */
  readonly verdict?: DecisionVerdict;
  /** IDs of alternative decisions considered */
  readonly alternativeIds: readonly ContentAddress[];
  /** When the decision was proposed */
  readonly proposedAt: Timestamp;
  /** When the decision was evaluated */
  readonly evaluatedAt?: Timestamp;
  /** When the decision was committed/rejected */
  readonly concludedAt?: Timestamp;
  /** Approval information (if required) */
  readonly approval?: DecisionApproval;
}

/**
 * Approval information for escalated decisions
 */
export interface DecisionApproval {
  /** Who approved/rejected */
  readonly decidedBy: ContentAddress;
  /** Approval decision */
  readonly decision: 'approved' | 'rejected';
  /** Justification provided */
  readonly justification?: string;
  /** When the approval was made */
  readonly decidedAt: Timestamp;
}

/**
 * Input for proposing a new decision
 */
export interface ProposeDecisionInput {
  /** The action being proposed */
  readonly action: DecisionAction;
  /** Actor proposing the decision */
  readonly proposedBy: ContentAddress;
  /** Context references */
  readonly contextRefs: readonly DecisionContextRef[];
  /** Rationale for the decision */
  readonly rationale?: string;
  /** Pre-identified alternatives */
  readonly alternativeIds?: readonly ContentAddress[];
}

/**
 * Transaction for atomic decision operations
 */
export interface DecisionTransaction {
  /** Transaction ID */
  readonly id: ContentAddress;
  /** The decision being transacted */
  readonly decisionId: ContentAddress;
  /** Operation type */
  readonly operation: 'propose' | 'evaluate' | 'commit' | 'reject' | 'approve' | 'cancel';
  /** Transaction status */
  readonly status: 'pending' | 'completed' | 'rolled_back' | 'failed';
  /** Started at */
  readonly startedAt: Timestamp;
  /** Completed at */
  readonly completedAt?: Timestamp;
  /** Error if failed */
  readonly error?: string;
}

/**
 * Decision state machine for managing lifecycle transitions
 */
export class DecisionStateMachine {
  private decisions: Map<ContentAddress, Decision> = new Map();
  private transactions: Map<ContentAddress, DecisionTransaction> = new Map();

  /**
   * Propose a new decision
   */
  async propose(input: ProposeDecisionInput): Promise<Decision> {
    const proposedAt = new Date().toISOString();

    const baseDecisionData = {
      state: 'PROPOSED' as const,
      action: input.action,
      proposedBy: input.proposedBy,
      contextRefs: input.contextRefs,
      alternativeIds: input.alternativeIds ?? [],
      proposedAt,
    };

    const decisionData =
      input.rationale !== undefined
        ? { ...baseDecisionData, rationale: input.rationale }
        : baseDecisionData;

    const id = computeContentAddress(decisionData);

    const decision: Decision = {
      id,
      ...decisionData,
    };

    this.decisions.set(id, decision);
    return decision;
  }

  /**
   * Record policy evaluation for a decision
   */
  async evaluate(decisionId: ContentAddress, verdict: DecisionVerdict): Promise<Decision> {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }

    this.validateTransition(decision.state, 'EVALUATED');

    const evaluatedAt = new Date().toISOString();

    // Determine next state based on verdict
    let nextState: DecisionStateValue;
    switch (verdict.result) {
      case 'ALLOW':
      case 'ANNOTATE':
        nextState = 'EVALUATED';
        break;
      case 'DENY':
        nextState = 'REJECTED';
        break;
      case 'ESCALATE':
        nextState = 'PENDING_APPROVAL';
        break;
      default:
        nextState = 'EVALUATED';
    }

    const updatedDecision: Decision = {
      ...decision,
      state: nextState,
      verdict,
      evaluatedAt,
      ...(nextState === 'REJECTED' ? { concludedAt: evaluatedAt } : {}),
    };

    this.decisions.set(decisionId, updatedDecision);
    return updatedDecision;
  }

  /**
   * Commit a decision (atomic operation)
   */
  async commit(decisionId: ContentAddress): Promise<Decision> {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }

    this.validateTransition(decision.state, 'COMMITTED');

    // Start transaction
    const txn = await this.startTransaction(decisionId, 'commit');

    try {
      const concludedAt = new Date().toISOString();

      const committedDecision: Decision = {
        ...decision,
        state: 'COMMITTED',
        concludedAt,
      };

      // Atomic commit
      this.decisions.set(decisionId, committedDecision);
      await this.completeTransaction(txn.id);

      return committedDecision;
    } catch (error) {
      await this.rollbackTransaction(
        txn.id,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Reject a decision
   */
  async reject(decisionId: ContentAddress, reason?: string): Promise<Decision> {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }

    this.validateTransition(decision.state, 'REJECTED');

    const concludedAt = new Date().toISOString();

    const baseRejected = {
      ...decision,
      state: 'REJECTED' as const,
      concludedAt,
    };

    const newRationale = reason ?? decision.rationale;
    const rejectedDecision: Decision =
      newRationale !== undefined ? { ...baseRejected, rationale: newRationale } : baseRejected;

    this.decisions.set(decisionId, rejectedDecision);
    return rejectedDecision;
  }

  /**
   * Record approval for a pending decision
   */
  async approve(
    decisionId: ContentAddress,
    approvedBy: ContentAddress,
    justification?: string
  ): Promise<Decision> {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }

    if (decision.state !== 'PENDING_APPROVAL') {
      throw new Error(`Decision ${decisionId} is not pending approval`);
    }

    const decidedAt = new Date().toISOString();

    const approval: DecisionApproval =
      justification !== undefined
        ? { decidedBy: approvedBy, decision: 'approved', justification, decidedAt }
        : { decidedBy: approvedBy, decision: 'approved', decidedAt };

    const approvedDecision: Decision = {
      ...decision,
      state: 'EVALUATED',
      approval,
    };

    this.decisions.set(decisionId, approvedDecision);
    return approvedDecision;
  }

  /**
   * Cancel a decision before commitment
   */
  async cancel(decisionId: ContentAddress, reason?: string): Promise<Decision> {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }

    this.validateTransition(decision.state, 'CANCELLED');

    const concludedAt = new Date().toISOString();

    const baseCancelled = {
      ...decision,
      state: 'CANCELLED' as const,
      concludedAt,
    };

    const newRationale = reason ?? decision.rationale;
    const cancelledDecision: Decision =
      newRationale !== undefined ? { ...baseCancelled, rationale: newRationale } : baseCancelled;

    this.decisions.set(decisionId, cancelledDecision);
    return cancelledDecision;
  }

  /**
   * Get a decision by ID
   */
  getDecision(id: ContentAddress): Decision | undefined {
    return this.decisions.get(id);
  }

  /**
   * Check if a state transition is valid
   */
  private validateTransition(from: DecisionStateValue, to: DecisionStateValue): void {
    const validTargets = VALID_TRANSITIONS[from];
    if (!validTargets.includes(to)) {
      throw new Error(
        `Invalid state transition: ${from} → ${to}. Valid transitions: ${validTargets.join(', ') || 'none'}`
      );
    }
  }

  /**
   * Start a transaction
   */
  private async startTransaction(
    decisionId: ContentAddress,
    operation: DecisionTransaction['operation']
  ): Promise<DecisionTransaction> {
    const startedAt = new Date().toISOString();
    const txnData = { decisionId, operation, startedAt };
    const id = computeContentAddress(txnData);

    const txn: DecisionTransaction = {
      id,
      decisionId,
      operation,
      status: 'pending',
      startedAt,
    };

    this.transactions.set(id, txn);
    return txn;
  }

  /**
   * Complete a transaction
   */
  private async completeTransaction(txnId: ContentAddress): Promise<void> {
    const txn = this.transactions.get(txnId);
    if (!txn) {
      throw new Error(`Transaction not found: ${txnId}`);
    }

    const completedTxn: DecisionTransaction = {
      ...txn,
      status: 'completed',
      completedAt: new Date().toISOString(),
    };

    this.transactions.set(txnId, completedTxn);
  }

  /**
   * Rollback a transaction
   */
  private async rollbackTransaction(txnId: ContentAddress, error: string): Promise<void> {
    const txn = this.transactions.get(txnId);
    if (!txn) {
      throw new Error(`Transaction not found: ${txnId}`);
    }

    const rolledBackTxn: DecisionTransaction = {
      ...txn,
      status: 'rolled_back',
      completedAt: new Date().toISOString(),
      error,
    };

    this.transactions.set(txnId, rolledBackTxn);
  }
}

/**
 * Create a decision state machine
 */
export function createDecisionStateMachine(): DecisionStateMachine {
  return new DecisionStateMachine();
}

/**
 * Check if a decision is in a terminal state
 */
export function isTerminalState(state: DecisionStateValue): boolean {
  return VALID_TRANSITIONS[state].length === 0;
}

/**
 * Check if a decision can be committed
 */
export function canCommit(decision: Decision): boolean {
  return decision.state === 'EVALUATED' && decision.verdict?.result !== 'DENY';
}

/**
 * Convert decision to payload for storage
 */
export function toDecisionPayload(decision: Decision): DecisionPayload {
  const lifecycle: DecisionPayload['lifecycle'] =
    decision.state === 'COMMITTED'
      ? 'COMMITTED'
      : decision.state === 'REJECTED'
        ? 'REJECTED'
        : decision.state === 'EVALUATED' || decision.state === 'PENDING_APPROVAL'
          ? 'EVALUATED'
          : 'PROPOSED';

  const basePayload = {
    schemaVersion: '1.0' as const,
    action: decision.action,
    lifecycle,
    alternativeIds: decision.alternativeIds,
  };

  return decision.rationale !== undefined
    ? { ...basePayload, rationale: decision.rationale }
    : basePayload;
}
