/**
 * "Why" Query Engine for ContextGraph OS
 *
 * Implements EPIC 7 Capability 7.1:
 * T7.1.1 Implement "Why was X done?" query
 * T7.1.2 Display context + policy + decision chain
 *
 * Every decision must be explainable. No black boxes.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { GraphNode, ContextPayload } from '../core/types/node.js';
import type { Decision } from '../decision/lifecycle.js';
import type { Alternative } from '../decision/alternatives.js';
import type { PolicyDefinition } from '../policy/schema.js';
import type { DecisionVerdict } from '../policy/evaluator.js';
import type { Actor } from '../actor/identity.js';

/**
 * Context node type alias for convenience
 */
type ContextNode = GraphNode<ContextPayload>;

/**
 * Why query result
 */
export interface WhyQueryResult {
  /** The subject being queried about */
  readonly subject: QuerySubject;
  /** The explanation chain */
  readonly explanation: ExplanationChain;
  /** Summary answer */
  readonly summary: string;
  /** Confidence level in the explanation */
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** When the query was executed */
  readonly queriedAt: Timestamp;
}

/**
 * Subject of a why query
 */
export interface QuerySubject {
  /** Type of subject */
  readonly type: 'decision' | 'artifact' | 'action' | 'policy_violation';
  /** Subject ID */
  readonly id: ContentAddress;
  /** Human-readable description */
  readonly description: string;
}

/**
 * Chain of explanations
 */
export interface ExplanationChain {
  /** Root cause/trigger */
  readonly trigger: ExplanationNode;
  /** Intermediate steps */
  readonly steps: readonly ExplanationNode[];
  /** Final outcome */
  readonly outcome: ExplanationNode;
  /** Context nodes involved */
  readonly contexts: readonly ContextReference[];
  /** Policies that applied */
  readonly policies: readonly PolicyReference[];
  /** Actors involved */
  readonly actors: readonly ActorReference[];
  /** Alternatives considered */
  readonly alternatives: readonly AlternativeReference[];
}

/**
 * A node in the explanation chain
 */
export interface ExplanationNode {
  /** Node type */
  readonly type: 'context' | 'decision' | 'policy' | 'action' | 'artifact';
  /** Node ID */
  readonly id: ContentAddress;
  /** What happened */
  readonly description: string;
  /** When it happened */
  readonly timestamp: Timestamp;
  /** Who was responsible */
  readonly actorId?: ContentAddress;
  /** Causal links to other nodes */
  readonly causedBy?: readonly ContentAddress[];
  /** What this led to */
  readonly ledTo?: readonly ContentAddress[];
}

/**
 * Reference to a context node
 */
export interface ContextReference {
  /** Context ID */
  readonly id: ContentAddress;
  /** Context type */
  readonly contextType: string;
  /** How it was used */
  readonly usage: 'input' | 'reference' | 'constraint';
  /** Relevance to the decision */
  readonly relevance: number;
  /** Summary of the context */
  readonly summary: string;
}

/**
 * Reference to a policy
 */
export interface PolicyReference {
  /** Policy ID */
  readonly id: ContentAddress;
  /** Policy name */
  readonly name: string;
  /** How the policy was applied */
  readonly application: 'allowed' | 'blocked' | 'escalated' | 'annotated';
  /** Specific clauses that matched */
  readonly matchedClauses?: readonly string[];
}

/**
 * Reference to an actor
 */
export interface ActorReference {
  /** Actor ID */
  readonly id: ContentAddress;
  /** Actor name */
  readonly name: string;
  /** Role in this explanation */
  readonly role: 'proposer' | 'approver' | 'executor' | 'affected';
}

/**
 * Reference to an alternative
 */
export interface AlternativeReference {
  /** Alternative ID */
  readonly id: ContentAddress;
  /** What the alternative was */
  readonly description: string;
  /** Why it wasn't chosen */
  readonly rejectionReason?: string | undefined;
}

/**
 * Why Query Engine
 *
 * Answers questions about why decisions were made.
 */
export class WhyQueryEngine {
  private decisions: Map<ContentAddress, Decision> = new Map();
  private alternatives: Map<ContentAddress, Alternative> = new Map();
  private contexts: Map<ContentAddress, ContextNode> = new Map();
  private policies: Map<ContentAddress, PolicyDefinition> = new Map();
  private actors: Map<ContentAddress, Actor> = new Map();
  private verdicts: Map<ContentAddress, DecisionVerdict> = new Map();

  /**
   * Register data sources for querying
   */
  registerDecision(decision: Decision, verdict?: DecisionVerdict): void {
    this.decisions.set(decision.id, decision);
    if (verdict) {
      this.verdicts.set(decision.id, verdict);
    }
  }

  registerAlternative(alternative: Alternative): void {
    this.alternatives.set(alternative.id, alternative);
  }

  registerContext(context: ContextNode): void {
    this.contexts.set(context.id, context);
  }

  registerPolicy(policy: PolicyDefinition): void {
    this.policies.set(policy.id, policy);
  }

  registerActor(actor: Actor): void {
    this.actors.set(actor.id, actor);
  }

  /**
   * Query: "Why was this decision made?"
   */
  whyDecision(decisionId: ContentAddress): WhyQueryResult | null {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      return null;
    }

    const verdict = this.verdicts.get(decisionId);
    const queriedAt = new Date().toISOString();

    // Build explanation chain
    const trigger = this.buildTriggerNode(decision);
    const steps = this.buildStepNodes(decision, verdict);
    const outcome = this.buildOutcomeNode(decision);
    const contexts = this.buildContextReferences(decision);
    const policies = this.buildPolicyReferences(verdict);
    const actors = this.buildActorReferences(decision);
    const alternatives = this.buildAlternativeReferences(decision);

    const explanation: ExplanationChain = {
      trigger,
      steps,
      outcome,
      contexts,
      policies,
      actors,
      alternatives,
    };

    const summary = this.generateSummary(decision, verdict, contexts, policies);

    return {
      subject: {
        type: 'decision',
        id: decisionId,
        description: `Decision: ${decision.action.type}`,
      },
      explanation,
      summary,
      confidence: this.assessConfidence(explanation),
      queriedAt,
    };
  }

  /**
   * Query: "Why was this artifact created?"
   */
  whyArtifact(artifactId: ContentAddress, producingDecisionId: ContentAddress): WhyQueryResult | null {
    const decision = this.decisions.get(producingDecisionId);
    if (!decision) {
      return null;
    }

    const decisionResult = this.whyDecision(producingDecisionId);
    if (!decisionResult) {
      return null;
    }

    return {
      ...decisionResult,
      subject: {
        type: 'artifact',
        id: artifactId,
        description: `Artifact produced by decision ${producingDecisionId}`,
      },
    };
  }

  /**
   * Query: "Why was this policy violated?"
   */
  whyViolation(
    decisionId: ContentAddress,
    violationIndex: number
  ): WhyQueryResult | null {
    const verdict = this.verdicts.get(decisionId);
    if (!verdict || !verdict.violations[violationIndex]) {
      return null;
    }

    const violation = verdict.violations[violationIndex];
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      return null;
    }

    const queriedAt = new Date().toISOString();

    const trigger: ExplanationNode = {
      type: 'action',
      id: decisionId,
      description: `Action attempted: ${decision.action.type}`,
      timestamp: decision.proposedAt,
      actorId: decision.proposedBy,
    };

    const policyNode: ExplanationNode = {
      type: 'policy',
      id: violation.policyId,
      description: `Policy violated: ${violation.message}`,
      timestamp: decision.evaluatedAt ?? decision.proposedAt,
      causedBy: [decisionId],
    };

    const outcome: ExplanationNode = {
      type: 'decision',
      id: decisionId,
      description: `Decision ${verdict.result.toLowerCase()}`,
      timestamp: decision.evaluatedAt ?? decision.proposedAt,
      causedBy: [violation.policyId],
    };

    const explanation: ExplanationChain = {
      trigger,
      steps: [policyNode],
      outcome,
      contexts: this.buildContextReferences(decision),
      policies: [{
        id: violation.policyId,
        name: violation.policyId, // Would need policy lookup
        application: 'blocked',
        matchedClauses: [violation.message],
      }],
      actors: this.buildActorReferences(decision),
      alternatives: [],
    };

    return {
      subject: {
        type: 'policy_violation',
        id: violation.policyId,
        description: violation.message,
      },
      explanation,
      summary: `The action "${decision.action.type}" violated policy because: ${violation.message}`,
      confidence: 'HIGH',
      queriedAt,
    };
  }

  /**
   * Query: "Why not this alternative?"
   */
  whyNotAlternative(alternativeId: ContentAddress): {
    alternative: Alternative;
    reason: string;
    explanation: string;
  } | null {
    const alternative = this.alternatives.get(alternativeId);
    if (!alternative) {
      return null;
    }

    if (!alternative.rejection) {
      return {
        alternative,
        reason: 'Still under consideration',
        explanation: 'This alternative has not been rejected and may still be chosen.',
      };
    }

    return {
      alternative,
      reason: alternative.rejection.reason,
      explanation: alternative.rejection.explanation,
    };
  }

  /**
   * Get full decision context
   */
  getDecisionContext(decisionId: ContentAddress): {
    decision: Decision;
    verdict?: DecisionVerdict | undefined;
    contexts: readonly ContextNode[];
    actors: readonly Actor[];
    alternatives: readonly Alternative[];
  } | null {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      return null;
    }

    const verdict = this.verdicts.get(decisionId);

    const contexts = decision.contextRefs
      .map((ref) => this.contexts.get(ref.contextId))
      .filter((c): c is ContextNode => c !== undefined);

    const actorIds = new Set<ContentAddress>([decision.proposedBy]);
    if (decision.approval?.decidedBy) {
      actorIds.add(decision.approval.decidedBy);
    }
    const actors = Array.from(actorIds)
      .map((id) => this.actors.get(id))
      .filter((a): a is Actor => a !== undefined);

    const alternatives = decision.alternativeIds
      .map((id) => this.alternatives.get(id))
      .filter((a): a is Alternative => a !== undefined);

    return {
      decision,
      verdict,
      contexts,
      actors,
      alternatives,
    };
  }

  // Private helper methods

  private buildTriggerNode(decision: Decision): ExplanationNode {
    const firstContext = decision.contextRefs[0];
    if (firstContext) {
      const context = this.contexts.get(firstContext.contextId);
      return {
        type: 'context',
        id: firstContext.contextId,
        description: context
          ? `Context received: ${context.payload.schemaVersion}`
          : `Context: ${firstContext.contextId}`,
        timestamp: decision.proposedAt,
        ledTo: [decision.id],
      };
    }

    return {
      type: 'action',
      id: decision.id,
      description: `Action initiated: ${decision.action.type}`,
      timestamp: decision.proposedAt,
      actorId: decision.proposedBy,
      ledTo: [decision.id],
    };
  }

  private buildStepNodes(decision: Decision, verdict?: DecisionVerdict): ExplanationNode[] {
    const steps: ExplanationNode[] = [];

    // Add decision proposal step
    steps.push({
      type: 'decision',
      id: decision.id,
      description: `Decision proposed: ${decision.action.type}`,
      timestamp: decision.proposedAt,
      actorId: decision.proposedBy,
    });

    // Add policy evaluation step if verdict exists
    if (verdict && decision.evaluatedAt) {
      for (const violation of verdict.violations) {
        steps.push({
          type: 'policy',
          id: violation.policyId,
          description: `Policy evaluated: ${violation.message}`,
          timestamp: decision.evaluatedAt,
          causedBy: [decision.id],
        });
      }
    }

    // Add approval step if exists
    if (decision.approval) {
      steps.push({
        type: 'decision',
        id: decision.id,
        description: `Decision ${decision.approval.decision} by approver`,
        timestamp: decision.approval.decidedAt,
        actorId: decision.approval.decidedBy,
      });
    }

    return steps;
  }

  private buildOutcomeNode(decision: Decision): ExplanationNode {
    return {
      type: 'decision',
      id: decision.id,
      description: `Decision ${decision.state.toLowerCase()}: ${decision.action.type}`,
      timestamp: decision.concludedAt ?? decision.evaluatedAt ?? decision.proposedAt,
      actorId: decision.proposedBy,
    };
  }

  private buildContextReferences(decision: Decision): ContextReference[] {
    return decision.contextRefs.map((ref) => {
      const context = this.contexts.get(ref.contextId);
      return {
        id: ref.contextId,
        contextType: context?.payload.schemaVersion ?? 'unknown',
        usage: ref.usage,
        relevance: ref.relevance ?? 1.0,
        summary: context
          ? `Context node: ${context.payload.schemaVersion}`
          : `Referenced context: ${ref.contextId}`,
      };
    });
  }

  private buildPolicyReferences(verdict?: DecisionVerdict): PolicyReference[] {
    if (!verdict) {
      return [];
    }

    const policyRefs: PolicyReference[] = [];
    const seenPolicies = new Set<ContentAddress>();

    for (const violation of verdict.violations) {
      if (seenPolicies.has(violation.policyId)) {continue;}
      seenPolicies.add(violation.policyId);

      const policy = this.policies.get(violation.policyId);
      policyRefs.push({
        id: violation.policyId,
        name: policy?.name ?? violation.policyId,
        application: verdict.result === 'DENY' ? 'blocked' :
                     verdict.result === 'ESCALATE' ? 'escalated' :
                     verdict.result === 'ANNOTATE' ? 'annotated' : 'allowed',
        matchedClauses: [violation.message],
      });
    }

    return policyRefs;
  }

  private buildActorReferences(decision: Decision): ActorReference[] {
    const refs: ActorReference[] = [];
    const actor = this.actors.get(decision.proposedBy);

    refs.push({
      id: decision.proposedBy,
      name: actor?.name ?? 'Unknown',
      role: 'proposer',
    });

    if (decision.approval) {
      const approver = this.actors.get(decision.approval.decidedBy);
      refs.push({
        id: decision.approval.decidedBy,
        name: approver?.name ?? 'Unknown',
        role: 'approver',
      });
    }

    return refs;
  }

  private buildAlternativeReferences(decision: Decision): AlternativeReference[] {
    return decision.alternativeIds.map((id) => {
      const alt = this.alternatives.get(id);
      return {
        id,
        description: alt?.consideration ?? 'Alternative considered',
        rejectionReason: alt?.rejection?.explanation,
      };
    });
  }

  private generateSummary(
    decision: Decision,
    verdict: DecisionVerdict | undefined,
    contexts: ContextReference[],
    _policies: PolicyReference[]
  ): string {
    const parts: string[] = [];

    parts.push(`The decision to "${decision.action.type}" was ${decision.state.toLowerCase()}.`);

    if (contexts.length > 0) {
      parts.push(`It was based on ${contexts.length} context(s).`);
    }

    if (verdict) {
      if (verdict.violations.length > 0) {
        parts.push(`${verdict.violations.length} policy violation(s) were identified.`);
      }
      parts.push(`The final verdict was: ${verdict.result}.`);
    }

    if (decision.rationale) {
      parts.push(`Rationale: ${decision.rationale}`);
    }

    return parts.join(' ');
  }

  private assessConfidence(explanation: ExplanationChain): 'HIGH' | 'MEDIUM' | 'LOW' {
    // High confidence if we have good context and policy information
    if (explanation.contexts.length > 0 && explanation.policies.length > 0) {
      return 'HIGH';
    }

    // Medium confidence if we have some information
    if (explanation.contexts.length > 0 || explanation.policies.length > 0) {
      return 'MEDIUM';
    }

    // Low confidence otherwise
    return 'LOW';
  }
}

/**
 * Create a why query engine
 */
export function createWhyQueryEngine(): WhyQueryEngine {
  return new WhyQueryEngine();
}
