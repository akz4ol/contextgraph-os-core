/**
 * Policy Evaluation Pipeline for ContextGraph OS
 *
 * Implements EPIC 3 Capability 3.2:
 * T3.2.1 Evaluate policies against Context Snapshot
 * T3.2.2 Generate Policy Verdict nodes
 * T3.2.3 Attach verdicts to Decision candidates
 *
 * The evaluation pipeline ensures no execution happens without a policy verdict.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import { computeContentAddress } from '../core/identity/content-address.js';
import type {
  PolicyDefinition,
  PolicyEvaluationContext,
  EnforcementModeValue,
  RuleFormatValue,
} from './schema.js';
import { isPolicyActive } from './schema.js';

/**
 * Verdict result type
 */
export type VerdictResult = 'ALLOW' | 'DENY' | 'ESCALATE' | 'ANNOTATE';

/**
 * Policy violation record
 */
export interface PolicyViolation {
  /** Policy that was violated */
  readonly policyId: ContentAddress;
  /** Violation message */
  readonly message: string;
  /** Severity level */
  readonly severity: 'info' | 'warning' | 'error' | 'critical';
}

/**
 * Result of evaluating a single policy
 */
export interface PolicyVerdictResult {
  /** Whether the policy passed */
  readonly passed: boolean;
  /** The enforcement action to take */
  readonly enforcement: EnforcementModeValue;
  /** Human-readable explanation */
  readonly explanation: string;
  /** Annotations to attach to the decision */
  readonly annotations: readonly string[];
  /** Whether the evaluation errored */
  readonly error?: string;
}

/**
 * Complete verdict for a decision after all policies evaluated
 */
export interface DecisionVerdict {
  /** Unique ID for this verdict */
  readonly id: ContentAddress;
  /** The decision being evaluated */
  readonly decisionId: ContentAddress;
  /** Overall result */
  readonly result: VerdictResult;
  /** Scope that was evaluated */
  readonly scope: string;
  /** Individual policy results */
  readonly policyResults: readonly PolicyVerdictEntry[];
  /** Policies that blocked the decision */
  readonly blockingPolicies: readonly ContentAddress[];
  /** Policies that require escalation */
  readonly escalatingPolicies: readonly ContentAddress[];
  /** All annotations from policies */
  readonly annotations: readonly string[];
  /** Policy violations found */
  readonly violations: readonly PolicyViolation[];
  /** Timestamp of evaluation */
  readonly evaluatedAt: Timestamp;
  /** Time taken to evaluate (ms) */
  readonly evaluationTimeMs: number;
}

/**
 * Entry for a single policy evaluation in the verdict
 */
export interface PolicyVerdictEntry {
  /** The policy that was evaluated */
  readonly policyId: ContentAddress;
  /** Policy name for reference */
  readonly policyName: string;
  /** Policy version */
  readonly policyVersion: string;
  /** The verdict for this policy */
  readonly verdict: PolicyVerdictResult;
}

/**
 * Rule evaluator function type
 */
export type RuleEvaluator = (
  expression: string,
  context: PolicyEvaluationContext
) => Promise<boolean>;

/**
 * Registry of rule evaluators by format
 */
export interface RuleEvaluatorRegistry {
  register(format: RuleFormatValue, evaluator: RuleEvaluator): void;
  get(format: RuleFormatValue): RuleEvaluator | undefined;
  evaluate(
    format: RuleFormatValue,
    expression: string,
    context: PolicyEvaluationContext
  ): Promise<boolean>;
}

/**
 * Create a rule evaluator registry with default evaluators
 */
export function createRuleEvaluatorRegistry(): RuleEvaluatorRegistry {
  const evaluators = new Map<RuleFormatValue, RuleEvaluator>();

  // Register default expression evaluator
  evaluators.set('expression', createExpressionEvaluator());

  // Register default JavaScript evaluator
  evaluators.set('javascript', createJavaScriptEvaluator());

  return {
    register(format: RuleFormatValue, evaluator: RuleEvaluator): void {
      evaluators.set(format, evaluator);
    },
    get(format: RuleFormatValue): RuleEvaluator | undefined {
      return evaluators.get(format);
    },
    async evaluate(
      format: RuleFormatValue,
      expression: string,
      context: PolicyEvaluationContext
    ): Promise<boolean> {
      const evaluator = evaluators.get(format);
      if (!evaluator) {
        throw new Error(`No evaluator registered for format: ${format}`);
      }
      return evaluator(expression, context);
    },
  };
}

/**
 * Create a simple expression evaluator
 * Supports basic comparisons like "amount > 10000"
 */
function createExpressionEvaluator(): RuleEvaluator {
  return async (expression: string, context: PolicyEvaluationContext): Promise<boolean> => {
    // Parse simple expressions like "amount > 10000" or "actor.type == 'AGENT'"
    const operators = ['>=', '<=', '!=', '==', '>', '<'];

    for (const op of operators) {
      if (expression.includes(op)) {
        const parts = expression.split(op).map((s) => s.trim());
        const left = parts[0] ?? '';
        const right = parts[1] ?? '';
        const leftValue = resolveValue(left, context);
        const rightValue = parseValue(right);

        switch (op) {
          case '>=':
            return Number(leftValue) >= Number(rightValue);
          case '<=':
            return Number(leftValue) <= Number(rightValue);
          case '!=':
            return leftValue !== rightValue;
          case '==':
            return leftValue === rightValue;
          case '>':
            return Number(leftValue) > Number(rightValue);
          case '<':
            return Number(leftValue) < Number(rightValue);
        }
      }
    }

    // If no operator found, treat as boolean field reference
    const value = resolveValue(expression, context);
    return Boolean(value);
  };
}

/**
 * Resolve a dotted path value from context
 */
function resolveValue(path: string, context: PolicyEvaluationContext): unknown {
  const parts = path.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Parse a literal value from string
 */
function parseValue(value: string | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }

  // Remove quotes for strings
  if ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }

  // Try number
  const num = Number(value);
  if (!isNaN(num)) {
    return num;
  }

  // Boolean
  if (value === 'true') {return true;}
  if (value === 'false') {return false;}
  if (value === 'null') {return null;}

  return value;
}

/**
 * Create a JavaScript evaluator (sandboxed)
 */
function createJavaScriptEvaluator(): RuleEvaluator {
  return async (expression: string, context: PolicyEvaluationContext): Promise<boolean> => {
    // Create a sandboxed evaluation context
    const sandbox = {
      decision: context.decision,
      actor: context.actor,
      contexts: context.contexts,
      timestamp: context.timestamp,
      extra: context.extra ?? {},
    };

    // Create function from expression
    const fn = new Function(
      ...Object.keys(sandbox),
      `"use strict"; return (${expression});`
    );

    const result = fn(...Object.values(sandbox));
    return Boolean(result);
  };
}

/**
 * Policy Evaluation Engine
 */
export class PolicyEvaluator {
  private readonly registry: RuleEvaluatorRegistry;

  constructor(registry?: RuleEvaluatorRegistry) {
    this.registry = registry ?? createRuleEvaluatorRegistry();
  }

  /**
   * Evaluate a single policy against a context
   */
  async evaluatePolicy(
    policy: PolicyDefinition,
    context: PolicyEvaluationContext
  ): Promise<PolicyVerdictResult> {
    // Check if policy is active
    if (!isPolicyActive(policy, context.timestamp)) {
      return {
        passed: true,
        enforcement: policy.enforcement,
        explanation: 'Policy not active at evaluation time',
        annotations: [],
      };
    }

    try {
      // Evaluate the rule
      const passed = await this.registry.evaluate(
        policy.rule.format,
        policy.rule.expression,
        context
      );

      if (passed) {
        return {
          passed: true,
          enforcement: policy.enforcement,
          explanation: policy.rule.explanation ?? 'Policy passed',
          annotations: [],
        };
      }

      // Policy violated
      return {
        passed: false,
        enforcement: policy.enforcement,
        explanation: policy.rule.explanation ?? `Policy '${policy.name}' violated`,
        annotations: [`POLICY_VIOLATION:${policy.name}`],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        passed: false,
        enforcement: 'BLOCK', // Fail safe - block on error
        explanation: `Error evaluating policy: ${errorMessage}`,
        annotations: [`POLICY_ERROR:${policy.name}`],
        error: errorMessage,
      };
    }
  }

  /**
   * Evaluate all applicable policies and generate a verdict
   */
  async evaluateAll(
    policies: readonly PolicyDefinition[],
    context: PolicyEvaluationContext
  ): Promise<DecisionVerdict> {
    const startTime = Date.now();
    const policyResults: PolicyVerdictEntry[] = [];
    const blockingPolicies: ContentAddress[] = [];
    const escalatingPolicies: ContentAddress[] = [];
    const allAnnotations: string[] = [];

    for (const policy of policies) {
      const policyId = computeContentAddress(policy);
      const verdict = await this.evaluatePolicy(policy, context);

      policyResults.push({
        policyId,
        policyName: policy.name,
        policyVersion: policy.version,
        verdict,
      });

      allAnnotations.push(...verdict.annotations);

      if (!verdict.passed) {
        switch (verdict.enforcement) {
          case 'BLOCK':
            blockingPolicies.push(policyId);
            break;
          case 'ESCALATE':
            escalatingPolicies.push(policyId);
            break;
        }
      }
    }

    // Determine overall result
    let result: DecisionVerdict['result'];
    if (blockingPolicies.length > 0) {
      result = 'DENY';
    } else if (escalatingPolicies.length > 0) {
      result = 'ESCALATE';
    } else if (allAnnotations.length > 0) {
      result = 'ANNOTATE';
    } else {
      result = 'ALLOW';
    }

    const evaluatedAt = new Date().toISOString();
    const violations: PolicyViolation[] = policyResults
      .filter((pr) => !pr.verdict.passed)
      .map((pr) => ({
        policyId: pr.policyId,
        message: pr.verdict.explanation,
        severity: pr.verdict.enforcement === 'BLOCK' ? 'critical' as const : 'warning' as const,
      }));

    const verdictData = {
      decisionId: context.decision.id,
      result,
      scope: context.decision.type,
      policyResults,
      blockingPolicies,
      escalatingPolicies,
      annotations: allAnnotations,
      violations,
      evaluatedAt,
      evaluationTimeMs: Date.now() - startTime,
    };

    return {
      id: computeContentAddress(verdictData),
      ...verdictData,
    };
  }

  /**
   * Register a custom rule evaluator
   */
  registerEvaluator(format: RuleFormatValue, evaluator: RuleEvaluator): void {
    this.registry.register(format, evaluator);
  }
}

/**
 * Create a policy evaluator
 */
export function createPolicyEvaluator(
  registry?: RuleEvaluatorRegistry
): PolicyEvaluator {
  return new PolicyEvaluator(registry);
}
