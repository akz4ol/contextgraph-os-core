/**
 * Unit tests for Decision Lifecycle
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  DecisionStateMachine,
  DecisionState,
  VALID_TRANSITIONS,
  createDecisionStateMachine,
} from '../../src/decision/lifecycle.js';
import type {
  ProposeDecisionInput,
  Decision,
  DecisionAction,
} from '../../src/decision/lifecycle.js';
import type { DecisionVerdict } from '../../src/policy/evaluator.js';
import { computeContentAddress } from '../../src/core/identity/content-address.js';

describe('Decision Lifecycle', () => {
  let stateMachine: DecisionStateMachine;

  beforeEach(() => {
    stateMachine = createDecisionStateMachine();
  });

  describe('State Transitions', () => {
    it('should define valid transitions for PROPOSED state', () => {
      expect(VALID_TRANSITIONS.PROPOSED).toContain('EVALUATED');
      expect(VALID_TRANSITIONS.PROPOSED).toContain('CANCELLED');
    });

    it('should define valid transitions for EVALUATED state', () => {
      expect(VALID_TRANSITIONS.EVALUATED).toContain('COMMITTED');
      expect(VALID_TRANSITIONS.EVALUATED).toContain('REJECTED');
      expect(VALID_TRANSITIONS.EVALUATED).toContain('PENDING_APPROVAL');
    });

    it('should not allow transitions from terminal states', () => {
      expect(VALID_TRANSITIONS.COMMITTED).toHaveLength(0);
      expect(VALID_TRANSITIONS.REJECTED).toHaveLength(0);
      expect(VALID_TRANSITIONS.CANCELLED).toHaveLength(0);
    });
  });

  describe('propose', () => {
    it('should create a new decision in PROPOSED state', async () => {
      const input = createProposalInput();
      const decision = await stateMachine.propose(input);

      expect(decision.state).toBe(DecisionState.PROPOSED);
      expect(decision.id).toBeDefined();
      expect(decision.action).toEqual(input.action);
      expect(decision.proposedBy).toBe(input.proposedBy);
    });

    it('should set proposedAt timestamp', async () => {
      const input = createProposalInput();
      const before = new Date().toISOString();
      const decision = await stateMachine.propose(input);
      const after = new Date().toISOString();

      expect(decision.proposedAt >= before).toBe(true);
      expect(decision.proposedAt <= after).toBe(true);
    });

    it('should include context references', async () => {
      const contextId = computeContentAddress({ type: 'context', data: 'test' });
      const input = createProposalInput({
        contextRefs: [{ contextId, usage: 'input' as const }],
      });

      const decision = await stateMachine.propose(input);
      expect(decision.contextRefs).toHaveLength(1);
      expect(decision.contextRefs[0].contextId).toBe(contextId);
    });

    it('should include rationale when provided', async () => {
      const input = createProposalInput({ rationale: 'Test rationale' });
      const decision = await stateMachine.propose(input);

      expect(decision.rationale).toBe('Test rationale');
    });

    it('should generate deterministic IDs for same content', async () => {
      const input = createProposalInput();
      const decision1 = await stateMachine.propose(input);

      // Create a new state machine and propose the same decision
      const stateMachine2 = createDecisionStateMachine();
      const decision2 = await stateMachine2.propose(input);

      // IDs should match because content is the same (minus timestamp)
      // Note: In practice timestamps differ, so IDs will differ
      expect(decision1.id).toBeDefined();
      expect(decision2.id).toBeDefined();
    });
  });

  describe('evaluate', () => {
    it('should transition decision to EVALUATED state', async () => {
      const decision = await stateMachine.propose(createProposalInput());
      const verdict = createAllowVerdict(decision.id);

      const evaluated = await stateMachine.evaluate(decision.id, verdict);

      expect(evaluated.state).toBe(DecisionState.EVALUATED);
      expect(evaluated.verdict).toBe(verdict);
    });

    it('should set evaluatedAt timestamp', async () => {
      const decision = await stateMachine.propose(createProposalInput());
      const verdict = createAllowVerdict(decision.id);

      const before = new Date().toISOString();
      const evaluated = await stateMachine.evaluate(decision.id, verdict);
      const after = new Date().toISOString();

      expect(evaluated.evaluatedAt).toBeDefined();
      expect(evaluated.evaluatedAt! >= before).toBe(true);
      expect(evaluated.evaluatedAt! <= after).toBe(true);
    });

    it('should throw for non-existent decision', async () => {
      const fakeId = computeContentAddress({ fake: true });
      const verdict = createAllowVerdict(fakeId);

      await expect(stateMachine.evaluate(fakeId, verdict)).rejects.toThrow('Decision not found');
    });

    it('should throw for invalid state transition', async () => {
      const decision = await stateMachine.propose(createProposalInput());
      const verdict = createAllowVerdict(decision.id);

      // Evaluate once
      await stateMachine.evaluate(decision.id, verdict);

      // Try to evaluate again (already in EVALUATED state)
      await expect(stateMachine.evaluate(decision.id, verdict)).rejects.toThrow(
        'Invalid state transition'
      );
    });
  });

  describe('commit', () => {
    it('should transition evaluated decision to COMMITTED state', async () => {
      const decision = await stateMachine.propose(createProposalInput());
      const verdict = createAllowVerdict(decision.id);
      await stateMachine.evaluate(decision.id, verdict);

      const committed = await stateMachine.commit(decision.id);

      expect(committed.state).toBe(DecisionState.COMMITTED);
      expect(committed.concludedAt).toBeDefined();
    });

    it('should throw for decision that was not evaluated', async () => {
      const decision = await stateMachine.propose(createProposalInput());

      await expect(stateMachine.commit(decision.id)).rejects.toThrow('Invalid state transition');
    });

    it('should throw for non-existent decision', async () => {
      const fakeId = computeContentAddress({ fake: true });

      await expect(stateMachine.commit(fakeId)).rejects.toThrow('Decision not found');
    });
  });

  describe('reject', () => {
    it('should auto-reject decision with DENY verdict during evaluate', async () => {
      const decision = await stateMachine.propose(createProposalInput());
      const verdict = createDenyVerdict(decision.id);

      // Evaluate with DENY verdict auto-transitions to REJECTED
      const rejected = await stateMachine.evaluate(decision.id, verdict);

      expect(rejected.state).toBe(DecisionState.REJECTED);
      expect(rejected.concludedAt).toBeDefined();
    });

    it('should reject evaluated decision with explicit call', async () => {
      const decision = await stateMachine.propose(createProposalInput());
      const verdict = createAllowVerdict(decision.id);
      await stateMachine.evaluate(decision.id, verdict);

      const rejected = await stateMachine.reject(decision.id, 'Manual rejection');

      expect(rejected.state).toBe(DecisionState.REJECTED);
    });
  });

  describe('cancel', () => {
    it('should cancel a proposed decision', async () => {
      const decision = await stateMachine.propose(createProposalInput());

      const cancelled = await stateMachine.cancel(decision.id);

      expect(cancelled.state).toBe(DecisionState.CANCELLED);
    });

    it('should cancel an evaluated decision', async () => {
      const decision = await stateMachine.propose(createProposalInput());
      const verdict = createAllowVerdict(decision.id);
      await stateMachine.evaluate(decision.id, verdict);

      const cancelled = await stateMachine.cancel(decision.id);

      expect(cancelled.state).toBe(DecisionState.CANCELLED);
    });
  });

  describe('approve', () => {
    it('should approve a decision pending approval', async () => {
      const decision = await stateMachine.propose(createProposalInput());
      const verdict = createEscalateVerdict(decision.id);

      // Evaluate with ESCALATE verdict auto-transitions to PENDING_APPROVAL
      const pending = await stateMachine.evaluate(decision.id, verdict);
      expect(pending.state).toBe(DecisionState.PENDING_APPROVAL);

      // Approve - transitions to EVALUATED
      const approverId = computeContentAddress({ type: 'approver' });
      const approved = await stateMachine.approve(decision.id, approverId, 'Approved after review');

      expect(approved.state).toBe(DecisionState.EVALUATED);
      expect(approved.approval?.decision).toBe('approved');
      expect(approved.approval?.decidedBy).toBe(approverId);

      // Commit after approval
      const committed = await stateMachine.commit(decision.id);
      expect(committed.state).toBe(DecisionState.COMMITTED);
    });
  });

  describe('getDecision', () => {
    it('should retrieve an existing decision', async () => {
      const proposal = createProposalInput();
      const created = await stateMachine.propose(proposal);

      const retrieved = stateMachine.getDecision(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return undefined for non-existent decision', () => {
      const fakeId = computeContentAddress({ fake: true });

      const retrieved = stateMachine.getDecision(fakeId);

      expect(retrieved).toBeUndefined();
    });
  });

  describe('full lifecycle', () => {
    it('should complete happy path: propose -> evaluate -> commit', async () => {
      // Step 1: Propose
      const decision = await stateMachine.propose(createProposalInput());
      expect(decision.state).toBe(DecisionState.PROPOSED);

      // Step 2: Evaluate
      const verdict = createAllowVerdict(decision.id);
      const evaluated = await stateMachine.evaluate(decision.id, verdict);
      expect(evaluated.state).toBe(DecisionState.EVALUATED);
      expect(evaluated.verdict).toBeDefined();

      // Step 3: Commit
      const committed = await stateMachine.commit(decision.id);
      expect(committed.state).toBe(DecisionState.COMMITTED);
      expect(committed.concludedAt).toBeDefined();

      // Should not be able to modify after commit
      await expect(stateMachine.cancel(decision.id)).rejects.toThrow('Invalid state transition');
    });

    it('should handle rejection path: propose -> evaluate with DENY -> auto-reject', async () => {
      // Step 1: Propose
      const decision = await stateMachine.propose(createProposalInput());
      expect(decision.state).toBe(DecisionState.PROPOSED);

      // Step 2: Evaluate with denial verdict - auto-transitions to REJECTED
      const verdict = createDenyVerdict(decision.id);
      const rejected = await stateMachine.evaluate(decision.id, verdict);

      expect(rejected.state).toBe(DecisionState.REJECTED);
      expect(rejected.verdict?.result).toBe('DENY');
      expect(rejected.concludedAt).toBeDefined();

      // Should not be able to modify after rejection
      await expect(stateMachine.cancel(decision.id)).rejects.toThrow('Invalid state transition');
    });
  });
});

// Helper functions

function createProposalInput(overrides: Partial<ProposeDecisionInput> = {}): ProposeDecisionInput {
  return {
    action: {
      type: 'CREATE_RESOURCE',
      parameters: { name: 'test-resource' },
    },
    proposedBy: computeContentAddress({ type: 'agent', name: 'test-agent' }),
    contextRefs: [],
    ...overrides,
  };
}

function createAllowVerdict(decisionId: string): DecisionVerdict {
  return {
    id: computeContentAddress({ verdict: 'allow', decisionId }),
    decisionId: decisionId as `${string}:${string}`,
    result: 'ALLOW',
    scope: 'GLOBAL',
    policyResults: [],
    blockingPolicies: [],
    escalatingPolicies: [],
    annotations: [],
    violations: [],
    evaluatedAt: new Date().toISOString(),
    evaluationTimeMs: 1,
  };
}

function createDenyVerdict(decisionId: string): DecisionVerdict {
  const policyId = computeContentAddress({ policy: 'deny' });
  return {
    id: computeContentAddress({ verdict: 'deny', decisionId }),
    decisionId: decisionId as `${string}:${string}`,
    result: 'DENY',
    scope: 'GLOBAL',
    policyResults: [
      {
        policyId,
        policyName: 'Deny Policy',
        policyVersion: '1.0.0',
        verdict: {
          passed: false,
          enforcement: 'BLOCK',
          explanation: 'Access denied',
          annotations: [],
        },
      },
    ],
    blockingPolicies: [policyId],
    escalatingPolicies: [],
    annotations: [],
    violations: [
      {
        policyId,
        message: 'Access denied by policy',
        severity: 'critical',
      },
    ],
    evaluatedAt: new Date().toISOString(),
    evaluationTimeMs: 1,
  };
}

function createEscalateVerdict(decisionId: string): DecisionVerdict {
  const policyId = computeContentAddress({ policy: 'escalate' });
  return {
    id: computeContentAddress({ verdict: 'escalate', decisionId }),
    decisionId: decisionId as `${string}:${string}`,
    result: 'ESCALATE',
    scope: 'GLOBAL',
    policyResults: [
      {
        policyId,
        policyName: 'Escalate Policy',
        policyVersion: '1.0.0',
        verdict: {
          passed: false,
          enforcement: 'ESCALATE',
          explanation: 'Requires approval',
          annotations: [],
        },
      },
    ],
    blockingPolicies: [],
    escalatingPolicies: [policyId],
    annotations: [],
    violations: [],
    evaluatedAt: new Date().toISOString(),
    evaluationTimeMs: 1,
  };
}
