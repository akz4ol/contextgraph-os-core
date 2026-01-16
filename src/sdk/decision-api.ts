/**
 * Decision Proposal API for Agent SDK
 *
 * Implements EPIC 8 Capability 8.1:
 * T8.1.2 Provide decision proposal methods
 *
 * Think before you act. Always.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { Decision, DecisionAction, DecisionContextRef } from '../decision/lifecycle.js';
import type { DecisionVerdict, VerdictResult } from '../policy/evaluator.js';
import type { DeclaredContext } from './context-api.js';

/**
 * Decision proposal status
 */
export const ProposalStatus = {
  /** Proposal is being prepared */
  DRAFT: 'DRAFT',
  /** Proposal submitted for evaluation */
  SUBMITTED: 'SUBMITTED',
  /** Proposal approved */
  APPROVED: 'APPROVED',
  /** Proposal rejected */
  REJECTED: 'REJECTED',
  /** Proposal pending human approval */
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  /** Proposal executed */
  EXECUTED: 'EXECUTED',
} as const;

export type ProposalStatusValue = (typeof ProposalStatus)[keyof typeof ProposalStatus];

/**
 * Action builder for common action types
 */
export interface ActionBuilder {
  /** Set action type */
  withType(type: string): ActionBuilder;
  /** Add action parameter */
  withParam(key: string, value: unknown): ActionBuilder;
  /** Set target */
  withTarget(targetId: ContentAddress): ActionBuilder;
  /** Build the action */
  build(): DecisionAction;
}

/**
 * Decision proposal
 */
export interface Proposal {
  /** Proposal ID */
  readonly id: string;
  /** Current status */
  readonly status: ProposalStatusValue;
  /** The action being proposed */
  readonly action: DecisionAction;
  /** Context references */
  readonly contextRefs: readonly DecisionContextRef[];
  /** Rationale for the proposal */
  readonly rationale?: string;
  /** When the proposal was created */
  readonly createdAt: Timestamp;
  /** Verdict (if evaluated) */
  readonly verdict?: DecisionVerdict;
  /** Resulting decision (if submitted) */
  readonly decision?: Decision;
  /** Feedback from policy evaluation */
  readonly feedback: readonly PolicyFeedback[];
}

/**
 * Policy feedback for a proposal
 */
export interface PolicyFeedback {
  /** Policy ID */
  readonly policyId: ContentAddress;
  /** Feedback type */
  readonly type: 'info' | 'warning' | 'violation' | 'suggestion';
  /** Feedback message */
  readonly message: string;
  /** Suggested action */
  readonly suggestion?: string;
}

/**
 * Proposal submission options
 */
export interface SubmitOptions {
  /** Wait for approval if needed */
  readonly waitForApproval?: boolean;
  /** Timeout for waiting (ms) */
  readonly timeoutMs?: number;
  /** Execute immediately if approved */
  readonly autoExecute?: boolean;
}

/**
 * Proposal result
 */
export interface ProposalResult {
  /** The proposal */
  readonly proposal: Proposal;
  /** Whether the proposal was approved */
  readonly approved: boolean;
  /** The verdict result */
  readonly verdictResult: VerdictResult;
  /** Whether execution is allowed */
  readonly canExecute: boolean;
  /** Feedback messages */
  readonly feedback: readonly PolicyFeedback[];
}

/**
 * Decision evaluator interface
 */
export interface DecisionEvaluator {
  evaluate(action: DecisionAction, contexts: readonly DeclaredContext[]): Promise<DecisionVerdict>;
}

/**
 * Decision API for agents
 */
export class DecisionAPI {
  private proposals: Map<string, Proposal> = new Map();
  private proposalCounter = 0;
  private actorId: ContentAddress;
  private evaluator?: DecisionEvaluator;

  constructor(actorId: ContentAddress) {
    this.actorId = actorId;
  }

  /**
   * Get the actor ID for this API instance
   */
  getActorId(): ContentAddress {
    return this.actorId;
  }

  /**
   * Set the decision evaluator
   */
  setEvaluator(evaluator: DecisionEvaluator): void {
    this.evaluator = evaluator;
  }

  /**
   * Create a new action builder
   */
  action(): ActionBuilder {
    let actionType = '';
    const parameters: Record<string, unknown> = {};
    let targetId: ContentAddress | undefined;

    const builder: ActionBuilder = {
      withType(type: string) {
        actionType = type;
        return builder;
      },
      withParam(key: string, value: unknown) {
        parameters[key] = value;
        return builder;
      },
      withTarget(target: ContentAddress) {
        targetId = target;
        return builder;
      },
      build(): DecisionAction {
        if (!actionType) {
          throw new Error('Action type is required');
        }
        const base = { type: actionType, parameters };
        return targetId !== undefined ? { ...base, targetId } : base;
      },
    };

    return builder;
  }

  /**
   * Create a new proposal
   */
  propose(
    action: DecisionAction,
    contexts: readonly DeclaredContext[],
    rationale?: string
  ): Proposal {
    const id = `proposal-${++this.proposalCounter}`;
    const createdAt = new Date().toISOString();

    const contextRefs: DecisionContextRef[] = contexts.map((ctx, index) => ({
      contextId: ctx.id,
      usage: 'input' as const,
      relevance: 1.0 - index * 0.1, // Decreasing relevance by order
    }));

    const baseProposal = {
      id,
      status: ProposalStatus.DRAFT as ProposalStatusValue,
      action,
      contextRefs,
      createdAt,
      feedback: [] as PolicyFeedback[],
    };

    const proposal: Proposal = rationale !== undefined
      ? { ...baseProposal, rationale }
      : baseProposal;

    this.proposals.set(id, proposal);
    return proposal;
  }

  /**
   * Propose a simple action
   */
  proposeAction(
    actionType: string,
    params: Record<string, unknown>,
    contexts: readonly DeclaredContext[],
    rationale?: string
  ): Proposal {
    const action = this.action()
      .withType(actionType)
      .build();

    // Add params
    const actionWithParams: DecisionAction = {
      ...action,
      parameters: { ...action.parameters, ...params },
    };

    return this.propose(actionWithParams, contexts, rationale);
  }

  /**
   * Preview a proposal (get feedback without submitting)
   */
  async preview(proposalId: string): Promise<readonly PolicyFeedback[]> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    if (!this.evaluator) {
      return [];
    }

    // Get contexts from refs (in real implementation, would look up contexts)
    const contexts: DeclaredContext[] = [];

    const verdict = await this.evaluator.evaluate(proposal.action, contexts);
    const feedback = this.verdictToFeedback(verdict);

    // Update proposal with feedback
    const updatedProposal: Proposal = {
      ...proposal,
      feedback,
    };
    this.proposals.set(proposalId, updatedProposal);

    return feedback;
  }

  /**
   * Submit a proposal for evaluation
   */
  async submit(proposalId: string, _options: SubmitOptions = {}): Promise<ProposalResult> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    if (proposal.status !== ProposalStatus.DRAFT) {
      throw new Error(`Proposal ${proposalId} is not in draft status`);
    }

    // Update status to submitted
    let updatedProposal: Proposal = {
      ...proposal,
      status: ProposalStatus.SUBMITTED,
    };
    this.proposals.set(proposalId, updatedProposal);

    // Evaluate if evaluator is available
    let verdict: DecisionVerdict | undefined;
    let feedback: PolicyFeedback[] = [];

    if (this.evaluator) {
      const contexts: DeclaredContext[] = [];
      verdict = await this.evaluator.evaluate(proposal.action, contexts);
      feedback = this.verdictToFeedback(verdict);

      updatedProposal = {
        ...updatedProposal,
        verdict,
        feedback,
      };
    }

    // Determine final status based on verdict
    const verdictResult = verdict?.result ?? 'ALLOW';
    let finalStatus: ProposalStatusValue;
    let approved = false;
    let canExecute = false;

    switch (verdictResult) {
      case 'ALLOW':
      case 'ANNOTATE':
        finalStatus = ProposalStatus.APPROVED;
        approved = true;
        canExecute = true;
        break;
      case 'DENY':
        finalStatus = ProposalStatus.REJECTED;
        approved = false;
        canExecute = false;
        break;
      case 'ESCALATE':
        finalStatus = ProposalStatus.PENDING_APPROVAL;
        approved = false;
        canExecute = false;
        break;
      default:
        finalStatus = ProposalStatus.APPROVED;
        approved = true;
        canExecute = true;
    }

    updatedProposal = {
      ...updatedProposal,
      status: finalStatus,
    };
    this.proposals.set(proposalId, updatedProposal);

    return {
      proposal: updatedProposal,
      approved,
      verdictResult,
      canExecute,
      feedback,
    };
  }

  /**
   * Execute an approved proposal
   */
  async execute(proposalId: string): Promise<{
    success: boolean;
    proposal: Proposal;
    error?: string;
  }> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    if (proposal.status !== ProposalStatus.APPROVED) {
      return {
        success: false,
        proposal,
        error: `Cannot execute proposal in status: ${proposal.status}`,
      };
    }

    // In a real implementation, this would execute the action
    const updatedProposal: Proposal = {
      ...proposal,
      status: ProposalStatus.EXECUTED,
    };
    this.proposals.set(proposalId, updatedProposal);

    return {
      success: true,
      proposal: updatedProposal,
    };
  }

  /**
   * Get a proposal by ID
   */
  getProposal(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  /**
   * Get all proposals
   */
  getAllProposals(): readonly Proposal[] {
    return Array.from(this.proposals.values());
  }

  /**
   * Get proposals by status
   */
  getProposalsByStatus(status: ProposalStatusValue): readonly Proposal[] {
    return Array.from(this.proposals.values()).filter((p) => p.status === status);
  }

  /**
   * Withdraw a proposal
   */
  withdraw(proposalId: string): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return false;
    }

    if (proposal.status === ProposalStatus.EXECUTED) {
      throw new Error('Cannot withdraw an executed proposal');
    }

    this.proposals.delete(proposalId);
    return true;
  }

  /**
   * Convert verdict to feedback
   */
  private verdictToFeedback(verdict: DecisionVerdict): PolicyFeedback[] {
    const feedback: PolicyFeedback[] = [];

    for (const violation of verdict.violations) {
      feedback.push({
        policyId: violation.policyId,
        type: violation.severity === 'critical' ? 'violation' : 'warning',
        message: violation.message,
      });
    }

    // Add info feedback for annotations
    if (verdict.annotations) {
      for (const annotation of verdict.annotations) {
        feedback.push({
          policyId: verdict.decisionId, // Use decision ID as source
          type: 'info',
          message: annotation,
        });
      }
    }

    return feedback;
  }
}

/**
 * Create a decision API for an agent
 */
export function createDecisionAPI(actorId: ContentAddress): DecisionAPI {
  return new DecisionAPI(actorId);
}

/**
 * Common action types
 */
export const CommonActions = {
  /** Create a resource */
  CREATE: 'CREATE',
  /** Update a resource */
  UPDATE: 'UPDATE',
  /** Delete a resource */
  DELETE: 'DELETE',
  /** Read a resource */
  READ: 'READ',
  /** Execute a process */
  EXECUTE: 'EXECUTE',
  /** Approve something */
  APPROVE: 'APPROVE',
  /** Send a message */
  SEND: 'SEND',
  /** Transfer ownership */
  TRANSFER: 'TRANSFER',
} as const;
