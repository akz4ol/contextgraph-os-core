/**
 * Branch-Aware Lineage for ContextGraph OS
 *
 * Implements EPIC 2 Capability 2.3:
 * T2.3.1 Support parallel reasoning branches
 * T2.3.2 Preserve rejected alternatives
 * T2.3.3 Prevent branch collapse during storage
 *
 * Branch-aware lineage ensures that exploration (considering alternatives)
 * does not destroy accountability (knowing what was considered and why).
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { GraphNode } from '../core/types/node.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { GraphReader } from './backward-trace.js';

/**
 * A reasoning branch represents a path of exploration
 */
export interface ReasoningBranch {
  /** Unique identifier for this branch */
  readonly branchId: ContentAddress;
  /** The decision point where this branch originated */
  readonly branchPoint: ContentAddress;
  /** The final decision in this branch (if concluded) */
  readonly finalDecision?: GraphNode;
  /** All decisions in this branch */
  readonly decisions: readonly GraphNode[];
  /** Branch status */
  readonly status: 'active' | 'committed' | 'rejected' | 'abandoned';
  /** Why this branch was rejected (if applicable) */
  readonly rejectionReason?: string;
  /** When this branch was created */
  readonly createdAt: Timestamp;
  /** When this branch was concluded (if applicable) */
  readonly concludedAt?: Timestamp;
  /** Parent branch (if this is a sub-branch) */
  readonly parentBranchId?: ContentAddress;
}

/**
 * Branch comparison result
 */
export interface BranchComparison {
  /** The committed branch */
  readonly committedBranch: ReasoningBranch;
  /** Alternative branches that were considered */
  readonly alternativeBranches: readonly ReasoningBranch[];
  /** Decisions unique to the committed branch */
  readonly uniqueToCommitted: readonly GraphNode[];
  /** Decisions that were common across branches */
  readonly commonDecisions: readonly GraphNode[];
  /** Key differentiating factors */
  readonly differentiatingFactors: readonly DifferentiatingFactor[];
}

/**
 * A factor that differentiates branches
 */
export interface DifferentiatingFactor {
  /** Type of differentiation */
  readonly type: 'context' | 'policy' | 'authority' | 'outcome';
  /** Description of the difference */
  readonly description: string;
  /** Nodes involved in this differentiation */
  readonly involvedNodes: readonly ContentAddress[];
}

/**
 * Branch tree structure for visualization
 */
export interface BranchTree {
  /** Root decision point */
  readonly root: ContentAddress;
  /** All branches from this root */
  readonly branches: readonly ReasoningBranch[];
  /** Nested sub-branches */
  readonly subTrees: readonly BranchTree[];
  /** Total depth of the tree */
  readonly maxDepth: number;
}

/**
 * Options for branch operations
 */
export interface BranchOptions {
  /** Include abandoned branches */
  readonly includeAbandoned?: boolean;
  /** Include sub-branches */
  readonly includeSubBranches?: boolean;
  /** Maximum depth for sub-branch traversal */
  readonly maxSubBranchDepth?: number;
}

/**
 * Branch-Aware Lineage Tracker
 *
 * Tracks parallel reasoning branches and ensures that all alternatives
 * are preserved for accountability, even when not selected.
 */
export class BranchLineageTracker {
  private readonly graph: GraphReader;

  constructor(graph: GraphReader) {
    this.graph = graph;
  }

  /**
   * Get all branches that originated from a decision point
   */
  async getBranchesFromPoint(
    decisionPointId: ContentAddress,
    options: BranchOptions = {}
  ): Promise<readonly ReasoningBranch[]> {
    const branches: ReasoningBranch[] = [];
    const decisionPoint = await this.graph.getNode(decisionPointId);

    if (!decisionPoint) {
      throw new Error(`Decision point not found: ${decisionPointId}`);
    }

    // Get all alternative decisions from this point
    const alternativeEdges = await this.graph.getEdgesByType(
      decisionPointId,
      'ALTERNATIVE_TO',
      'outgoing'
    );

    // The original decision is the "committed" branch
    const committedBranch = await this.buildBranch(decisionPointId, decisionPointId, 'committed');
    branches.push(committedBranch);

    // Each alternative represents a rejected branch
    for (const edge of alternativeEdges) {
      const alternativeNode = await this.graph.getNode(edge.targetId);
      if (alternativeNode) {
        const branch = await this.buildBranch(edge.targetId, decisionPointId, 'rejected');
        if (options.includeAbandoned || branch.status !== 'abandoned') {
          branches.push(branch);
        }
      }
    }

    return branches;
  }

  /**
   * Compare a committed branch with its alternatives
   */
  async compareBranches(committedDecisionId: ContentAddress): Promise<BranchComparison> {
    const branches = await this.getBranchesFromPoint(committedDecisionId);
    const committedBranch = branches.find((b) => b.status === 'committed');

    if (!committedBranch) {
      throw new Error('No committed branch found');
    }

    const alternativeBranches = branches.filter((b) => b.status !== 'committed');

    // Find unique and common decisions
    const alternativeDecisionIds = new Set(
      alternativeBranches.flatMap((b) => b.decisions.map((d) => d.id))
    );

    const uniqueToCommitted = committedBranch.decisions.filter(
      (d) => !alternativeDecisionIds.has(d.id)
    );

    const commonDecisions = committedBranch.decisions.filter((d) =>
      alternativeDecisionIds.has(d.id)
    );

    // Analyze differentiating factors
    const differentiatingFactors = await this.analyzeDifferentiatingFactors(
      committedBranch,
      alternativeBranches
    );

    return {
      committedBranch,
      alternativeBranches,
      uniqueToCommitted,
      commonDecisions,
      differentiatingFactors,
    };
  }

  /**
   * Build a branch tree showing all exploration paths
   */
  async buildBranchTree(
    rootDecisionId: ContentAddress,
    options: BranchOptions = {}
  ): Promise<BranchTree> {
    const branches = await this.getBranchesFromPoint(rootDecisionId, options);
    const subTrees: BranchTree[] = [];
    let maxDepth = 1;

    if (options.includeSubBranches !== false) {
      const maxSubDepth = options.maxSubBranchDepth ?? 5;

      for (const branch of branches) {
        for (const decision of branch.decisions) {
          // Check if this decision has its own branches
          const hasSubBranches = await this.hasSubBranches(decision.id);
          if (hasSubBranches) {
            const subTree = await this.buildBranchTree(decision.id, {
              ...options,
              maxSubBranchDepth: maxSubDepth - 1,
            });
            subTrees.push(subTree);
            maxDepth = Math.max(maxDepth, 1 + subTree.maxDepth);
          }
        }
      }
    }

    return {
      root: rootDecisionId,
      branches,
      subTrees,
      maxDepth,
    };
  }

  /**
   * Get the rejection rationale for a branch
   */
  async getRejectionRationale(branchId: ContentAddress): Promise<string | null> {
    const node = await this.graph.getNode(branchId);
    if (!node || node.type !== 'DECISION') {
      return null;
    }

    const payload = node.payload as { rationale?: string };
    return payload.rationale ?? null;
  }

  /**
   * Check if a decision preserves all alternatives (branch integrity)
   */
  async verifyBranchIntegrity(decisionId: ContentAddress): Promise<{
    isIntact: boolean;
    missingAlternatives: readonly ContentAddress[];
    warnings: readonly string[];
  }> {
    const warnings: string[] = [];
    const missingAlternatives: ContentAddress[] = [];

    const decision = await this.graph.getNode(decisionId);
    if (!decision) {
      return {
        isIntact: false,
        missingAlternatives: [],
        warnings: ['Decision not found'],
      };
    }

    // Check if alternatives are preserved
    const payload = decision.payload as { alternativeIds?: readonly ContentAddress[] };
    const declaredAlternatives = payload.alternativeIds ?? [];

    for (const altId of declaredAlternatives) {
      const altNode = await this.graph.getNode(altId);
      if (!altNode) {
        missingAlternatives.push(altId);
        warnings.push(`Alternative ${altId} is missing from storage`);
      }
    }

    // Check for ALTERNATIVE_TO edges
    const altEdges = await this.graph.getEdgesByType(decisionId, 'ALTERNATIVE_TO', 'outgoing');

    if (altEdges.length !== declaredAlternatives.length) {
      warnings.push(
        `Mismatch between declared alternatives (${declaredAlternatives.length}) ` +
          `and edges (${altEdges.length})`
      );
    }

    return {
      isIntact: missingAlternatives.length === 0 && warnings.length === 0,
      missingAlternatives,
      warnings,
    };
  }

  /**
   * Build a reasoning branch from a starting decision
   */
  private async buildBranch(
    startDecisionId: ContentAddress,
    branchPointId: ContentAddress,
    status: ReasoningBranch['status']
  ): Promise<ReasoningBranch> {
    const decisions: GraphNode[] = [];
    const startNode = await this.graph.getNode(startDecisionId);

    if (startNode) {
      decisions.push(startNode);

      // Follow the chain of decisions
      let currentId = startDecisionId;
      const visited = new Set<ContentAddress>([currentId]);

      while (true) {
        const outgoingEdges = await this.graph.getEdgesByType(currentId, 'CAUSES', 'outgoing');

        const nextDecisionEdge = outgoingEdges.find(async (e) => {
          const node = await this.graph.getNode(e.targetId);
          return node?.type === 'DECISION';
        });

        if (!nextDecisionEdge || visited.has(nextDecisionEdge.targetId)) {
          break;
        }

        const nextNode = await this.graph.getNode(nextDecisionEdge.targetId);
        if (nextNode && nextNode.type === 'DECISION') {
          decisions.push(nextNode);
          visited.add(nextNode.id);
          currentId = nextNode.id;
        } else {
          break;
        }
      }
    }

    const finalDecision = decisions[decisions.length - 1];
    const rejectionReason =
      status === 'rejected' ? await this.getRejectionRationale(startDecisionId) : null;

    // Build the branch object, only including optional fields if they exist
    const branch: ReasoningBranch = {
      branchId: startDecisionId,
      branchPoint: branchPointId,
      decisions,
      status,
      createdAt: startNode?.createdAt ?? new Date().toISOString(),
    };

    // Add optional properties only if they have values
    if (finalDecision !== undefined) {
      (branch as { finalDecision: GraphNode }).finalDecision = finalDecision;
    }
    if (rejectionReason !== null) {
      (branch as { rejectionReason: string }).rejectionReason = rejectionReason;
    }
    if (finalDecision?.createdAt !== undefined) {
      (branch as { concludedAt: Timestamp }).concludedAt = finalDecision.createdAt;
    }

    return branch;
  }

  /**
   * Check if a decision has sub-branches
   */
  private async hasSubBranches(decisionId: ContentAddress): Promise<boolean> {
    const altEdges = await this.graph.getEdgesByType(decisionId, 'ALTERNATIVE_TO', 'outgoing');
    return altEdges.length > 0;
  }

  /**
   * Analyze factors that differentiate branches
   */
  private async analyzeDifferentiatingFactors(
    committed: ReasoningBranch,
    alternatives: readonly ReasoningBranch[]
  ): Promise<readonly DifferentiatingFactor[]> {
    const factors: DifferentiatingFactor[] = [];

    // Compare context references
    const committedContexts = new Set<ContentAddress>();
    const alternativeContexts = new Set<ContentAddress>();

    for (const decision of committed.decisions) {
      const refs = await this.graph.getEdgesByType(decision.id, 'REFERENCES', 'outgoing');
      refs.forEach((e) => committedContexts.add(e.targetId));
    }

    for (const branch of alternatives) {
      for (const decision of branch.decisions) {
        const refs = await this.graph.getEdgesByType(decision.id, 'REFERENCES', 'outgoing');
        refs.forEach((e) => alternativeContexts.add(e.targetId));
      }
    }

    // Find context differences
    const uniqueCommittedContexts = [...committedContexts].filter(
      (c) => !alternativeContexts.has(c)
    );
    const uniqueAlternativeContexts = [...alternativeContexts].filter(
      (c) => !committedContexts.has(c)
    );

    if (uniqueCommittedContexts.length > 0 || uniqueAlternativeContexts.length > 0) {
      factors.push({
        type: 'context',
        description:
          `Committed branch referenced ${uniqueCommittedContexts.length} unique contexts, ` +
          `alternatives referenced ${uniqueAlternativeContexts.length} different contexts`,
        involvedNodes: [...uniqueCommittedContexts, ...uniqueAlternativeContexts],
      });
    }

    // Compare policy governance
    const committedPolicies = new Set<ContentAddress>();
    const alternativePolicies = new Set<ContentAddress>();

    for (const decision of committed.decisions) {
      const governed = await this.graph.getEdgesByType(decision.id, 'GOVERNED_BY', 'outgoing');
      governed.forEach((e) => committedPolicies.add(e.targetId));
    }

    for (const branch of alternatives) {
      for (const decision of branch.decisions) {
        const governed = await this.graph.getEdgesByType(decision.id, 'GOVERNED_BY', 'outgoing');
        governed.forEach((e) => alternativePolicies.add(e.targetId));
      }
    }

    const policyDiffs = [...committedPolicies].filter((p) => !alternativePolicies.has(p));

    if (policyDiffs.length > 0) {
      factors.push({
        type: 'policy',
        description: `Branches were subject to different policies`,
        involvedNodes: policyDiffs,
      });
    }

    return factors;
  }
}

/**
 * Create a branch lineage tracker
 */
export function createBranchTracker(graph: GraphReader): BranchLineageTracker {
  return new BranchLineageTracker(graph);
}
