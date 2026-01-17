/**
 * Unit tests for Policy Evaluator
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  PolicyEvaluator,
  createPolicyEvaluator,
  createRuleEvaluatorRegistry,
} from '../../src/policy/evaluator.js';
import type { PolicyDefinition, PolicyEvaluationContext } from '../../src/policy/schema.js';
import { computeContentAddress } from '../../src/core/identity/content-address.js';

describe('Policy Evaluator', () => {
  let evaluator: PolicyEvaluator;

  beforeEach(() => {
    evaluator = createPolicyEvaluator();
  });

  describe('createRuleEvaluatorRegistry', () => {
    it('should create registry with default evaluators', () => {
      const registry = createRuleEvaluatorRegistry();
      expect(registry.get('expression')).toBeDefined();
      expect(registry.get('javascript')).toBeDefined();
    });

    it('should allow registering custom evaluators', () => {
      const registry = createRuleEvaluatorRegistry();
      const customEvaluator = async (): Promise<boolean> => true;
      registry.register('custom', customEvaluator);
      expect(registry.get('custom')).toBe(customEvaluator);
    });

    it('should throw for unregistered format', async () => {
      const registry = createRuleEvaluatorRegistry();
      const context = createMockContext();
      await expect(registry.evaluate('rego', 'true', context)).rejects.toThrow(
        'No evaluator registered for format: rego'
      );
    });
  });

  describe('Expression Evaluator', () => {
    it('should evaluate simple comparisons', async () => {
      const policy = createPolicy({
        rule: { format: 'expression', expression: 'extra.amount > 100' },
      });
      const context = createMockContext({ extra: { amount: 150 } });

      const result = await evaluator.evaluatePolicy(policy, context);
      expect(result.passed).toBe(true);
    });

    it('should evaluate equality checks', async () => {
      const policy = createPolicy({
        rule: { format: 'expression', expression: "actor.type == 'AGENT'" },
      });
      const context = createMockContext();

      const result = await evaluator.evaluatePolicy(policy, context);
      expect(result.passed).toBe(true);
    });

    it('should evaluate less than comparisons', async () => {
      const policy = createPolicy({
        rule: { format: 'expression', expression: 'extra.risk < 0.5' },
      });
      const context = createMockContext({ extra: { risk: 0.3 } });

      const result = await evaluator.evaluatePolicy(policy, context);
      expect(result.passed).toBe(true);
    });

    it('should fail when expression evaluates to false', async () => {
      const policy = createPolicy({
        rule: { format: 'expression', expression: 'extra.amount < 50' },
      });
      const context = createMockContext({ extra: { amount: 100 } });

      const result = await evaluator.evaluatePolicy(policy, context);
      expect(result.passed).toBe(false);
    });
  });

  describe('JavaScript Evaluator', () => {
    it('should evaluate JavaScript expressions', async () => {
      const policy = createPolicy({
        rule: {
          format: 'javascript',
          expression: 'decision.type === "CREATE" && extra.approved === true',
        },
      });
      const context = createMockContext({ extra: { approved: true } });

      const result = await evaluator.evaluatePolicy(policy, context);
      expect(result.passed).toBe(true);
    });

    it('should access nested context data', async () => {
      const policy = createPolicy({
        rule: {
          format: 'javascript',
          expression: 'contexts.length > 0',
        },
      });
      const context = createMockContext();

      const result = await evaluator.evaluatePolicy(policy, context);
      expect(result.passed).toBe(true);
    });
  });

  describe('evaluatePolicy', () => {
    it('should skip inactive policies', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // Tomorrow
      const policy = createPolicy({
        activation: { activatesAt: futureDate },
      });
      const context = createMockContext();

      const result = await evaluator.evaluatePolicy(policy, context);
      expect(result.passed).toBe(true);
      expect(result.explanation).toBe('Policy not active at evaluation time');
    });

    it('should handle evaluation errors gracefully', async () => {
      const policy = createPolicy({
        rule: { format: 'javascript', expression: 'undefined.foo.bar' },
      });
      const context = createMockContext();

      const result = await evaluator.evaluatePolicy(policy, context);
      expect(result.passed).toBe(false);
      expect(result.enforcement).toBe('BLOCK'); // Fail-safe
      expect(result.error).toBeDefined();
    });

    it('should add annotations for violations', async () => {
      const policy = createPolicy({
        name: 'Test Policy',
        rule: { format: 'expression', expression: 'extra.amount < 10' },
      });
      const context = createMockContext({ extra: { amount: 100 } });

      const result = await evaluator.evaluatePolicy(policy, context);
      expect(result.passed).toBe(false);
      expect(result.annotations).toContain('POLICY_VIOLATION:Test Policy');
    });
  });

  describe('evaluateAll', () => {
    it('should return ALLOW when all policies pass', async () => {
      const policies = [
        createPolicy({ rule: { format: 'expression', expression: 'extra.a == 1' } }),
        createPolicy({ rule: { format: 'expression', expression: 'extra.b == 2' } }),
      ];
      const context = createMockContext({ extra: { a: 1, b: 2 } });

      const verdict = await evaluator.evaluateAll(policies, context);
      expect(verdict.result).toBe('ALLOW');
      expect(verdict.blockingPolicies).toHaveLength(0);
    });

    it('should return DENY when a BLOCK policy fails', async () => {
      const policies = [
        createPolicy({
          enforcement: 'BLOCK',
          rule: { format: 'expression', expression: 'extra.allowed == true' },
        }),
      ];
      const context = createMockContext({ extra: { allowed: false } });

      const verdict = await evaluator.evaluateAll(policies, context);
      expect(verdict.result).toBe('DENY');
      expect(verdict.blockingPolicies).toHaveLength(1);
    });

    it('should return ESCALATE when an ESCALATE policy fails', async () => {
      const policies = [
        createPolicy({
          enforcement: 'ESCALATE',
          rule: { format: 'expression', expression: 'extra.risk < 0.5' },
        }),
      ];
      const context = createMockContext({ extra: { risk: 0.8 } });

      const verdict = await evaluator.evaluateAll(policies, context);
      expect(verdict.result).toBe('ESCALATE');
      expect(verdict.escalatingPolicies).toHaveLength(1);
    });

    it('should return ANNOTATE when only ANNOTATE policies fail', async () => {
      const policies = [
        createPolicy({
          enforcement: 'ANNOTATE',
          rule: { format: 'expression', expression: 'extra.reviewed == true' },
        }),
      ];
      const context = createMockContext({ extra: { reviewed: false } });

      const verdict = await evaluator.evaluateAll(policies, context);
      expect(verdict.result).toBe('ANNOTATE');
      expect(verdict.annotations.length).toBeGreaterThan(0);
    });

    it('should track evaluation time', async () => {
      const policies = [createPolicy()];
      const context = createMockContext();

      const verdict = await evaluator.evaluateAll(policies, context);
      expect(verdict.evaluationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should generate violations for failed policies', async () => {
      const policies = [
        createPolicy({
          name: 'Amount Limit',
          enforcement: 'BLOCK',
          rule: { format: 'expression', expression: 'extra.amount < 1000' },
        }),
      ];
      const context = createMockContext({ extra: { amount: 5000 } });

      const verdict = await evaluator.evaluateAll(policies, context);
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0].severity).toBe('critical');
    });
  });
});

// Helper functions

function createPolicy(overrides: Partial<PolicyDefinition> = {}): PolicyDefinition {
  const basePolicy = {
    id: computeContentAddress({ name: overrides.name ?? 'test-policy', ts: Date.now() }),
    name: 'Test Policy',
    description: 'A test policy',
    scope: { type: 'GLOBAL' as const },
    rule: {
      format: 'expression' as const,
      expression: 'true',
    },
    enforcement: 'BLOCK' as const,
    version: '1.0.0',
    status: 'ACTIVE' as const,
    activation: {
      activatesAt: new Date(Date.now() - 86400000).toISOString(), // Yesterday
    },
  };

  return {
    ...basePolicy,
    ...overrides,
    rule: { ...basePolicy.rule, ...overrides.rule },
    scope: { ...basePolicy.scope, ...overrides.scope },
    activation: { ...basePolicy.activation, ...overrides.activation },
  } as PolicyDefinition;
}

function createMockContext(
  overrides: Partial<PolicyEvaluationContext> = {}
): PolicyEvaluationContext {
  return {
    decision: {
      id: computeContentAddress({ type: 'decision', ts: Date.now() }),
      type: 'CREATE',
      action: { operation: 'create', target: 'resource' },
    },
    actor: {
      id: computeContentAddress({ type: 'actor', ts: Date.now() }),
      type: 'AGENT',
      authorities: ['basic'],
    },
    contexts: [
      {
        id: computeContentAddress({ type: 'context', ts: Date.now() }),
        data: { source: 'test' },
      },
    ],
    timestamp: new Date().toISOString(),
    extra: {},
    ...overrides,
  };
}
