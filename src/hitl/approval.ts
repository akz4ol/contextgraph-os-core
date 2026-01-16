/**
 * Approval Workflow for ContextGraph OS
 *
 * Implements EPIC 6 Capability 6.1:
 * T6.1.1 Define approval request schema
 * T6.1.2 Route escalated decisions to approval queue
 * T6.1.3 Record approval outcomes
 *
 * Human oversight is not a bug. It's a feature.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import { computeContentAddress } from '../core/identity/content-address.js';

/**
 * Approval request status
 */
export const ApprovalStatus = {
  /** Waiting for review */
  PENDING: 'PENDING',
  /** Currently being reviewed */
  IN_REVIEW: 'IN_REVIEW',
  /** Approved by reviewer */
  APPROVED: 'APPROVED',
  /** Rejected by reviewer */
  REJECTED: 'REJECTED',
  /** Timed out without response */
  TIMED_OUT: 'TIMED_OUT',
  /** Withdrawn by requester */
  WITHDRAWN: 'WITHDRAWN',
} as const;

export type ApprovalStatusValue = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

/**
 * Priority levels for approval requests
 */
export const ApprovalPriority = {
  /** Low priority - can wait */
  LOW: 1,
  /** Normal priority */
  NORMAL: 2,
  /** High priority - needs attention soon */
  HIGH: 3,
  /** Critical - immediate attention required */
  CRITICAL: 4,
} as const;

export type ApprovalPriorityValue = (typeof ApprovalPriority)[keyof typeof ApprovalPriority];

/**
 * Approval request definition
 */
export interface ApprovalRequest {
  /** Unique request ID */
  readonly id: ContentAddress;
  /** The decision requiring approval */
  readonly decisionId: ContentAddress;
  /** Current status */
  readonly status: ApprovalStatusValue;
  /** Priority level */
  readonly priority: ApprovalPriorityValue;
  /** Who requested the approval (usually the system) */
  readonly requestedBy: ContentAddress;
  /** Reason for escalation */
  readonly reason: string;
  /** Policy that triggered escalation */
  readonly triggeringPolicyId?: ContentAddress;
  /** Designated approvers (actor IDs) */
  readonly approvers: readonly ContentAddress[];
  /** When the request was created */
  readonly createdAt: Timestamp;
  /** When the request expires */
  readonly expiresAt: Timestamp;
  /** Context for the approver */
  readonly context: ApprovalContext;
  /** Outcome (if resolved) */
  readonly outcome?: ApprovalOutcome;
}

/**
 * Context provided to approvers
 */
export interface ApprovalContext {
  /** Summary of the decision */
  readonly summary: string;
  /** Risk assessment */
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Impact description */
  readonly impact: string;
  /** Relevant policy excerpts */
  readonly policyExcerpts?: readonly string[];
  /** Related decisions (for context) */
  readonly relatedDecisionIds?: readonly ContentAddress[];
  /** Additional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Outcome of an approval decision
 */
export interface ApprovalOutcome {
  /** The decision made */
  readonly decision: 'approved' | 'rejected';
  /** Who made the decision */
  readonly decidedBy: ContentAddress;
  /** When the decision was made */
  readonly decidedAt: Timestamp;
  /** Justification for the decision */
  readonly justification?: string;
  /** Conditions attached to approval */
  readonly conditions?: readonly string[];
  /** Whether this was an automated decision (e.g., timeout) */
  readonly automated: boolean;
}

/**
 * Input for creating an approval request
 */
export interface CreateApprovalRequestInput {
  /** The decision requiring approval */
  readonly decisionId: ContentAddress;
  /** Who is requesting approval */
  readonly requestedBy: ContentAddress;
  /** Reason for escalation */
  readonly reason: string;
  /** Priority level */
  readonly priority?: ApprovalPriorityValue;
  /** Triggering policy ID */
  readonly triggeringPolicyId?: ContentAddress;
  /** Designated approvers */
  readonly approvers: readonly ContentAddress[];
  /** Timeout in milliseconds */
  readonly timeoutMs?: number;
  /** Context for approvers */
  readonly context: ApprovalContext;
}

/**
 * Approval queue for managing pending requests
 */
export class ApprovalQueue {
  private requests: Map<ContentAddress, ApprovalRequest> = new Map();
  private byDecision: Map<ContentAddress, ContentAddress> = new Map();
  private byApprover: Map<ContentAddress, Set<ContentAddress>> = new Map();

  /** Default timeout: 24 hours */
  private readonly defaultTimeoutMs = 24 * 60 * 60 * 1000;

  /**
   * Create a new approval request
   */
  createRequest(input: CreateApprovalRequestInput): ApprovalRequest {
    const createdAt = new Date().toISOString();
    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs;
    const expiresAt = new Date(Date.now() + timeoutMs).toISOString();

    const requestData = {
      decisionId: input.decisionId,
      requestedBy: input.requestedBy,
      reason: input.reason,
      createdAt,
    };

    const id = computeContentAddress(requestData);

    const baseRequest = {
      id,
      decisionId: input.decisionId,
      status: ApprovalStatus.PENDING as ApprovalStatusValue,
      priority: input.priority ?? ApprovalPriority.NORMAL,
      requestedBy: input.requestedBy,
      reason: input.reason,
      approvers: input.approvers,
      createdAt,
      expiresAt,
      context: input.context,
    };

    const request: ApprovalRequest = input.triggeringPolicyId !== undefined
      ? { ...baseRequest, triggeringPolicyId: input.triggeringPolicyId }
      : baseRequest;

    this.requests.set(id, request);
    this.byDecision.set(input.decisionId, id);

    // Index by approver
    for (const approverId of input.approvers) {
      const approverRequests = this.byApprover.get(approverId) ?? new Set();
      approverRequests.add(id);
      this.byApprover.set(approverId, approverRequests);
    }

    return request;
  }

  /**
   * Get an approval request by ID
   */
  getRequest(id: ContentAddress): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  /**
   * Get approval request for a decision
   */
  getRequestForDecision(decisionId: ContentAddress): ApprovalRequest | undefined {
    const requestId = this.byDecision.get(decisionId);
    return requestId ? this.requests.get(requestId) : undefined;
  }

  /**
   * Get pending requests for an approver
   */
  getPendingForApprover(approverId: ContentAddress): readonly ApprovalRequest[] {
    const requestIds = this.byApprover.get(approverId);
    if (!requestIds) {
      return [];
    }

    return Array.from(requestIds)
      .map((id) => this.requests.get(id))
      .filter((r): r is ApprovalRequest => r !== undefined)
      .filter((r) => r.status === ApprovalStatus.PENDING || r.status === ApprovalStatus.IN_REVIEW);
  }

  /**
   * Mark request as in review
   */
  startReview(requestId: ContentAddress, reviewerId: ContentAddress): ApprovalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Approval request not found: ${requestId}`);
    }

    if (request.status !== ApprovalStatus.PENDING) {
      throw new Error(`Request ${requestId} is not pending (status: ${request.status})`);
    }

    if (!request.approvers.includes(reviewerId)) {
      throw new Error(`Actor ${reviewerId} is not authorized to review this request`);
    }

    const updatedRequest: ApprovalRequest = {
      ...request,
      status: ApprovalStatus.IN_REVIEW,
    };

    this.requests.set(requestId, updatedRequest);
    return updatedRequest;
  }

  /**
   * Record approval decision
   */
  recordDecision(
    requestId: ContentAddress,
    decision: 'approved' | 'rejected',
    decidedBy: ContentAddress,
    options?: {
      justification?: string;
      conditions?: readonly string[];
    }
  ): ApprovalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Approval request not found: ${requestId}`);
    }

    if (request.status !== ApprovalStatus.PENDING && request.status !== ApprovalStatus.IN_REVIEW) {
      throw new Error(`Request ${requestId} cannot be decided (status: ${request.status})`);
    }

    if (!request.approvers.includes(decidedBy)) {
      throw new Error(`Actor ${decidedBy} is not authorized to decide on this request`);
    }

    const decidedAt = new Date().toISOString();

    const baseOutcome = {
      decision,
      decidedBy,
      decidedAt,
      automated: false,
    };

    const outcome: ApprovalOutcome = {
      ...baseOutcome,
      ...(options?.justification !== undefined && { justification: options.justification }),
      ...(options?.conditions !== undefined && { conditions: options.conditions }),
    };

    const updatedRequest: ApprovalRequest = {
      ...request,
      status: decision === 'approved' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
      outcome,
    };

    this.requests.set(requestId, updatedRequest);
    return updatedRequest;
  }

  /**
   * Withdraw an approval request
   */
  withdraw(requestId: ContentAddress, withdrawnBy: ContentAddress): ApprovalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Approval request not found: ${requestId}`);
    }

    if (request.status !== ApprovalStatus.PENDING && request.status !== ApprovalStatus.IN_REVIEW) {
      throw new Error(`Request ${requestId} cannot be withdrawn (status: ${request.status})`);
    }

    if (request.requestedBy !== withdrawnBy) {
      throw new Error(`Only the requester can withdraw the request`);
    }

    const updatedRequest: ApprovalRequest = {
      ...request,
      status: ApprovalStatus.WITHDRAWN,
    };

    this.requests.set(requestId, updatedRequest);
    return updatedRequest;
  }

  /**
   * Check for and process timed out requests
   */
  processTimeouts(defaultAction: 'reject' | 'escalate' = 'reject'): readonly ApprovalRequest[] {
    const now = new Date().toISOString();
    const timedOut: ApprovalRequest[] = [];

    for (const [id, request] of this.requests) {
      if (
        (request.status === ApprovalStatus.PENDING || request.status === ApprovalStatus.IN_REVIEW) &&
        request.expiresAt < now
      ) {
        const outcome: ApprovalOutcome = {
          decision: defaultAction === 'reject' ? 'rejected' : 'rejected',
          decidedBy: request.requestedBy, // System decision
          decidedAt: now,
          justification: 'Approval request timed out',
          automated: true,
        };

        const updatedRequest: ApprovalRequest = {
          ...request,
          status: ApprovalStatus.TIMED_OUT,
          outcome,
        };

        this.requests.set(id, updatedRequest);
        timedOut.push(updatedRequest);
      }
    }

    return timedOut;
  }

  /**
   * Get all pending requests sorted by priority
   */
  getAllPending(): readonly ApprovalRequest[] {
    return Array.from(this.requests.values())
      .filter((r) => r.status === ApprovalStatus.PENDING || r.status === ApprovalStatus.IN_REVIEW)
      .sort((a, b) => {
        // Sort by priority (descending) then by creation time (ascending)
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  /**
   * Get statistics about the queue
   */
  getStats(): {
    total: number;
    pending: number;
    inReview: number;
    approved: number;
    rejected: number;
    timedOut: number;
    withdrawn: number;
    byPriority: Record<ApprovalPriorityValue, number>;
  } {
    const stats = {
      total: 0,
      pending: 0,
      inReview: 0,
      approved: 0,
      rejected: 0,
      timedOut: 0,
      withdrawn: 0,
      byPriority: {
        [ApprovalPriority.LOW]: 0,
        [ApprovalPriority.NORMAL]: 0,
        [ApprovalPriority.HIGH]: 0,
        [ApprovalPriority.CRITICAL]: 0,
      } as Record<ApprovalPriorityValue, number>,
    };

    for (const request of this.requests.values()) {
      stats.total++;
      stats.byPriority[request.priority]++;

      switch (request.status) {
        case ApprovalStatus.PENDING:
          stats.pending++;
          break;
        case ApprovalStatus.IN_REVIEW:
          stats.inReview++;
          break;
        case ApprovalStatus.APPROVED:
          stats.approved++;
          break;
        case ApprovalStatus.REJECTED:
          stats.rejected++;
          break;
        case ApprovalStatus.TIMED_OUT:
          stats.timedOut++;
          break;
        case ApprovalStatus.WITHDRAWN:
          stats.withdrawn++;
          break;
      }
    }

    return stats;
  }
}

/**
 * Create an approval queue
 */
export function createApprovalQueue(): ApprovalQueue {
  return new ApprovalQueue();
}

/**
 * Helper to format priority for display
 */
export function formatPriority(priority: ApprovalPriorityValue): string {
  const labels: Record<ApprovalPriorityValue, string> = {
    [ApprovalPriority.LOW]: 'Low',
    [ApprovalPriority.NORMAL]: 'Normal',
    [ApprovalPriority.HIGH]: 'High',
    [ApprovalPriority.CRITICAL]: 'Critical',
  };
  return labels[priority];
}

/**
 * Helper to format status for display
 */
export function formatApprovalStatus(status: ApprovalStatusValue): string {
  const labels: Record<ApprovalStatusValue, string> = {
    PENDING: 'Pending Review',
    IN_REVIEW: 'Under Review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    TIMED_OUT: 'Timed Out',
    WITHDRAWN: 'Withdrawn',
  };
  return labels[status];
}
