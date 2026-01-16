/**
 * Integration tests for ContextGraph OS full workflow
 *
 * Tests the complete flow from context declaration through
 * decision proposal, policy evaluation, and commitment.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createAgentSDK } from '../../src/sdk/index.js';
import type { AgentSDK } from '../../src/sdk/index.js';
import { createPolicyEvaluator } from '../../src/policy/evaluator.js';
import type { PolicyEvaluator, DecisionVerdict } from '../../src/policy/evaluator.js';
import type { PolicyDefinition } from '../../src/policy/schema.js';
import { createDecisionStateMachine } from '../../src/decision/lifecycle.js';
import type { DecisionStateMachine, Decision } from '../../src/decision/lifecycle.js';
import { computeContentAddress } from '../../src/core/identity/content-address.js';
import type { DeclaredContext } from '../../src/sdk/context-api.js';

describe('Full Workflow Integration', () => {
  let sdk: AgentSDK;
  let policyEvaluator: PolicyEvaluator;
  let decisionStateMachine: DecisionStateMachine;
  const agentId = computeContentAddress({ type: 'agent', name: 'integration-test-agent' });

  beforeEach(() => {
    sdk = createAgentSDK(agentId);
    policyEvaluator = createPolicyEvaluator();
    decisionStateMachine = createDecisionStateMachine();
  });

  describe('Happy Path: Create Resource', () => {
    it('should complete full workflow: context -> decision -> policy -> commit', async () => {
      // Step 1: Declare context (user input)
      const userInput = sdk.context.declareUserInput(
        { request: 'Create a new document', documentName: 'test.md' },
        'cli'
      );
      expect(userInput.id).toBeDefined();
      expect(userInput.type).toBe('USER_INPUT');

      // Step 2: Declare system context
      const systemState = sdk.context.declareSystemState(
        { availableStorage: '10GB', currentUser: 'admin' },
        'system-monitor'
      );
      expect(systemState.id).toBeDefined();

      // Step 3: Propose a decision
      const proposal = sdk.decision.propose(
        sdk.decision
          .action()
          .withType('CREATE_DOCUMENT')
          .withParam('name', 'test.md')
          .withParam('type', 'markdown')
          .build(),
        [userInput, systemState],
        'User requested to create a new document'
      );
      expect(proposal.id).toBeDefined();
      expect(proposal.contextRefs).toHaveLength(2);

      // Step 4: Create a permissive policy
      const policy: PolicyDefinition = createAllowAllPolicy('Allow document creation');

      // Step 5: Evaluate the decision
      const evaluationContext = createEvaluationContext(proposal, [userInput, systemState]);
      const verdict = await policyEvaluator.evaluateAll([policy], evaluationContext);

      expect(verdict.result).toBe('ALLOW');
      expect(verdict.blockingPolicies).toHaveLength(0);

      // Step 6: Propose and evaluate in decision state machine
      const decision = await decisionStateMachine.propose({
        action: proposal.action,
        proposedBy: agentId,
        contextRefs: proposal.contextRefs,
        rationale: proposal.rationale,
      });
      expect(decision.state).toBe('PROPOSED');

      // Step 7: Evaluate the decision
      const evaluated = await decisionStateMachine.evaluate(decision.id, verdict);
      expect(evaluated.state).toBe('EVALUATED');
      expect(evaluated.verdict?.result).toBe('ALLOW');

      // Step 8: Commit the decision
      const committed = await decisionStateMachine.commit(decision.id);
      expect(committed.state).toBe('COMMITTED');
      expect(committed.concludedAt).toBeDefined();

      // Verify the decision is finalized
      const finalDecision = decisionStateMachine.getDecision(decision.id);
      expect(finalDecision?.state).toBe('COMMITTED');
    });
  });

  describe('Rejection Path: Policy Violation', () => {
    it('should reject decision when policy denies access', async () => {
      // Step 1: Declare context
      const userInput = sdk.context.declareUserInput(
        { request: 'Delete system files', path: '/etc/passwd' },
        'cli'
      );

      // Step 2: Propose a dangerous action
      const proposal = sdk.decision.propose(
        sdk.decision
          .action()
          .withType('DELETE_FILE')
          .withParam('path', '/etc/passwd')
          .build(),
        [userInput],
        'User requested to delete a system file'
      );

      // Step 3: Create a blocking policy for system files
      const policy: PolicyDefinition = createBlockSystemFilesPolicy();

      // Step 4: Evaluate the decision (include path in extra for policy check)
      const evaluationContext = createEvaluationContext(proposal, [userInput]);
      (evaluationContext.extra as Record<string, unknown>).path = '/etc/passwd';

      const verdict = await policyEvaluator.evaluateAll([policy], evaluationContext);

      expect(verdict.result).toBe('DENY');
      expect(verdict.blockingPolicies).toHaveLength(1);
      expect(verdict.violations).toHaveLength(1);

      // Step 5: Propose in state machine
      const decision = await decisionStateMachine.propose({
        action: proposal.action,
        proposedBy: agentId,
        contextRefs: proposal.contextRefs,
        rationale: proposal.rationale,
      });

      // Step 6: Evaluate with DENY verdict - auto-rejects
      const rejected = await decisionStateMachine.evaluate(decision.id, verdict);
      expect(rejected.state).toBe('REJECTED');
      expect(rejected.concludedAt).toBeDefined();

      // Verify cannot be committed
      await expect(decisionStateMachine.commit(decision.id)).rejects.toThrow(
        'Invalid state transition'
      );
    });
  });

  describe('Escalation Path: Human Approval Required', () => {
    it('should escalate decision when policy requires approval', async () => {
      // Step 1: Declare context for high-value operation
      const userInput = sdk.context.declareUserInput(
        { request: 'Transfer funds', amount: 50000 },
        'banking-app'
      );

      // Step 2: Propose a high-value action
      const proposal = sdk.decision.propose(
        sdk.decision
          .action()
          .withType('TRANSFER_FUNDS')
          .withParam('amount', 50000)
          .withParam('currency', 'USD')
          .build(),
        [userInput],
        'User requested high-value transfer'
      );

      // Step 3: Create an escalating policy for high amounts
      const policy: PolicyDefinition = createHighValueEscalationPolicy();

      // Step 4: Evaluate the decision
      const evaluationContext = createEvaluationContext(proposal, [userInput]);
      (evaluationContext.extra as Record<string, unknown>).amount = 50000;

      const verdict = await policyEvaluator.evaluateAll([policy], evaluationContext);

      expect(verdict.result).toBe('ESCALATE');
      expect(verdict.escalatingPolicies).toHaveLength(1);

      // Step 5: Propose in state machine
      const decision = await decisionStateMachine.propose({
        action: proposal.action,
        proposedBy: agentId,
        contextRefs: proposal.contextRefs,
        rationale: proposal.rationale,
      });

      // Step 6: Evaluate with ESCALATE verdict - goes to PENDING_APPROVAL
      const pending = await decisionStateMachine.evaluate(decision.id, verdict);
      expect(pending.state).toBe('PENDING_APPROVAL');

      // Step 7: Human approves (proper workflow path)
      const approverId = computeContentAddress({ type: 'human', name: 'supervisor' });
      const approved = await decisionStateMachine.approve(
        decision.id,
        approverId,
        'Approved after verification'
      );
      expect(approved.state).toBe('EVALUATED');
      expect(approved.approval?.decision).toBe('approved');

      // Step 8: Now can commit
      const committed = await decisionStateMachine.commit(decision.id);
      expect(committed.state).toBe('COMMITTED');
    });
  });

  describe('Cancellation Path', () => {
    it('should allow cancellation before commitment', async () => {
      // Declare context and propose
      const userInput = sdk.context.declareUserInput({ request: 'Test action' }, 'test');
      const proposal = sdk.decision.propose(
        sdk.decision.action().withType('TEST').build(),
        [userInput]
      );

      // Create decision
      const decision = await decisionStateMachine.propose({
        action: proposal.action,
        proposedBy: agentId,
        contextRefs: proposal.contextRefs,
      });

      // Cancel before evaluation
      const cancelled = await decisionStateMachine.cancel(decision.id, 'User cancelled request');
      expect(cancelled.state).toBe('CANCELLED');
      expect(cancelled.rationale).toBe('User cancelled request');

      // Cannot perform any more actions
      await expect(decisionStateMachine.commit(decision.id)).rejects.toThrow(
        'Invalid state transition'
      );
    });
  });

  describe('Multiple Policies Evaluation', () => {
    it('should evaluate multiple policies and combine results', async () => {
      // Declare context
      const userInput = sdk.context.declareUserInput(
        { request: 'Create document', author: 'testuser' },
        'editor'
      );

      // Propose action
      const proposal = sdk.decision.propose(
        sdk.decision
          .action()
          .withType('CREATE_DOCUMENT')
          .withParam('name', 'report.pdf')
          .build(),
        [userInput]
      );

      // Multiple policies
      const policies: PolicyDefinition[] = [
        createAllowAllPolicy('Base access policy'),
        createAnnotatePolicy('Audit policy'),
        createAllowAllPolicy('Secondary check'),
      ];

      const evaluationContext = createEvaluationContext(proposal, [userInput]);
      const verdict = await policyEvaluator.evaluateAll(policies, evaluationContext);

      // Should ANNOTATE because one policy adds annotation but none block
      expect(verdict.result).toBe('ANNOTATE');
      expect(verdict.policyResults).toHaveLength(3);
      expect(verdict.annotations.length).toBeGreaterThan(0);
      expect(verdict.blockingPolicies).toHaveLength(0);
    });
  });

  describe('Context Querying During Decision', () => {
    it('should query and filter contexts during decision making', () => {
      // Declare multiple contexts
      sdk.context.declareUserInput({ msg: 'first' }, 'user');
      sdk.context.declareExternalData({ api: 'data' }, 'external-api', { confidence: 0.8 });
      sdk.context.declareSystemState({ status: 'healthy' }, 'monitor');
      sdk.context.declare({
        type: 'CUSTOM',
        data: { custom: true },
        source: 'custom-source',
        tags: ['important'],
        confidence: 0.6,
      });

      // Query by type
      const userContexts = sdk.context.getByType('USER_INPUT');
      expect(userContexts).toHaveLength(1);

      // Query by confidence
      const highConfidence = sdk.context.query({ minConfidence: 0.7 });
      expect(highConfidence.length).toBeGreaterThan(0);
      expect(highConfidence.every((c) => c.confidence >= 0.7)).toBe(true);

      // Query by tags
      const important = sdk.context.getByTag('important');
      expect(important).toHaveLength(1);
      expect(important[0].tags).toContain('important');

      // Get stats
      const stats = sdk.context.getStats();
      expect(stats.total).toBe(4);
      expect(stats.active).toBe(4);
    });
  });

  describe('Artifact Registration After Commit', () => {
    it('should register artifact after decision is committed', async () => {
      // Full workflow
      const userInput = sdk.context.declareUserInput({ query: 'Generate report' }, 'cli');

      const proposal = sdk.decision.propose(
        sdk.decision.action().withType('GENERATE_REPORT').build(),
        [userInput]
      );

      const decision = await decisionStateMachine.propose({
        action: proposal.action,
        proposedBy: agentId,
        contextRefs: proposal.contextRefs,
      });

      const policy = createAllowAllPolicy('Allow reports');
      const evaluationContext = createEvaluationContext(proposal, [userInput]);
      const verdict = await policyEvaluator.evaluateAll([policy], evaluationContext);

      await decisionStateMachine.evaluate(decision.id, verdict);
      await decisionStateMachine.commit(decision.id);

      // Register the artifact
      const artifact = sdk.artifact.registerData(
        { reportContent: 'Report data...', generatedAt: new Date().toISOString() },
        decision.id,
        { description: 'Generated report', mimeType: 'application/json' }
      );

      expect(artifact.id).toBeDefined();
      expect(artifact.producedByDecisionId).toBe(decision.id);
      expect(artifact.contentHash).toBeDefined();
      expect(artifact.type).toBe('DATA');
      expect(artifact.mimeType).toBe('application/json');

      // Query artifacts by decision
      const artifactsByDecision = sdk.artifact.getByDecision(decision.id);
      expect(artifactsByDecision).toHaveLength(1);
      expect(artifactsByDecision[0].id).toBe(artifact.id);
    });
  });
});

// Helper functions

function createAllowAllPolicy(name: string): PolicyDefinition {
  return {
    id: computeContentAddress({ policy: name, ts: Date.now() }),
    name,
    description: 'Allows all actions',
    scope: { type: 'GLOBAL' },
    rule: {
      format: 'javascript',
      expression: 'true', // JavaScript evaluator handles literal true
    },
    enforcement: 'BLOCK',
    version: '1.0.0',
    status: 'ACTIVE',
    activation: {
      activatesAt: new Date(Date.now() - 86400000).toISOString(),
    },
  };
}

function createBlockSystemFilesPolicy(): PolicyDefinition {
  return {
    id: computeContentAddress({ policy: 'block-system', ts: Date.now() }),
    name: 'Block System Files',
    description: 'Blocks access to system files',
    scope: { type: 'GLOBAL' },
    rule: {
      format: 'javascript',
      // Policy passes when NOT deleting system files; fails (blocks) when deleting /etc files
      expression: '!(decision.type === "DELETE_FILE" && extra.path && extra.path.startsWith("/etc"))',
      explanation: 'System files cannot be deleted',
    },
    enforcement: 'BLOCK',
    version: '1.0.0',
    status: 'ACTIVE',
    activation: {
      activatesAt: new Date(Date.now() - 86400000).toISOString(),
    },
  };
}

function createHighValueEscalationPolicy(): PolicyDefinition {
  return {
    id: computeContentAddress({ policy: 'high-value-escalation', ts: Date.now() }),
    name: 'High Value Transaction Escalation',
    description: 'Requires approval for high-value transactions',
    scope: { type: 'GLOBAL' },
    rule: {
      format: 'expression',
      expression: 'extra.amount < 10000',
      explanation: 'Transactions over $10,000 require approval',
    },
    enforcement: 'ESCALATE',
    version: '1.0.0',
    status: 'ACTIVE',
    activation: {
      activatesAt: new Date(Date.now() - 86400000).toISOString(),
    },
  };
}

function createAnnotatePolicy(name: string): PolicyDefinition {
  return {
    id: computeContentAddress({ policy: name, ts: Date.now(), random: Math.random() }),
    name,
    description: 'Annotates actions for audit',
    scope: { type: 'GLOBAL' },
    rule: {
      format: 'javascript',
      expression: 'false', // Always triggers annotation (policy fails → adds annotation)
    },
    enforcement: 'ANNOTATE',
    version: '1.0.0',
    status: 'ACTIVE',
    activation: {
      activatesAt: new Date(Date.now() - 86400000).toISOString(),
    },
  };
}

interface ProposalLike {
  id: string;
  action: { type: string; parameters: Record<string, unknown> };
  contextRefs: readonly { contextId: string; usage: string }[];
  rationale?: string;
}

function createEvaluationContext(
  proposal: ProposalLike,
  contexts: readonly DeclaredContext[]
): {
  decision: { id: string; type: string; action: { operation: string; target: string } };
  actor: { id: string; type: string; authorities: string[] };
  contexts: readonly { id: string; data: unknown }[];
  timestamp: string;
  extra: Record<string, unknown>;
} {
  return {
    decision: {
      id: proposal.id,
      type: proposal.action.type,
      action: {
        operation: proposal.action.type,
        target: String(proposal.action.parameters.name ?? 'unknown'),
      },
    },
    actor: {
      id: computeContentAddress({ type: 'actor' }),
      type: 'AGENT',
      authorities: ['basic'],
    },
    contexts: contexts.map((c) => ({ id: c.id, data: c.data })),
    timestamp: new Date().toISOString(),
    extra: {},
  };
}
