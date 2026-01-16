/**
 * Policy Schema for ContextGraph OS
 *
 * Implements EPIC 3 Capability 3.1:
 * T3.1.1 Define policy schema (scope, rule, enforcement, version)
 * T3.1.2 Store policies as first-class graph nodes
 * T3.1.3 Support policy version activation windows
 *
 * Policies are first-class citizens in ContextGraph, treated as data
 * that can be queried, versioned, and traced like any other object.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';

/**
 * Enforcement modes for policy violations
 */
export const EnforcementMode = {
  /** Block the action entirely */
  BLOCK: 'BLOCK',
  /** Allow but annotate with warning */
  ANNOTATE: 'ANNOTATE',
  /** Require human approval before proceeding */
  ESCALATE: 'ESCALATE',
  /** Observe only - log but don't interfere (for policy development) */
  SHADOW: 'SHADOW',
} as const;

export type EnforcementModeValue = (typeof EnforcementMode)[keyof typeof EnforcementMode];

/**
 * Rule format/language for policy rules
 */
export const RuleFormat = {
  /** JavaScript predicate function */
  JAVASCRIPT: 'javascript',
  /** JSON Logic format */
  JSON_LOGIC: 'json-logic',
  /** Open Policy Agent Rego */
  REGO: 'rego',
  /** Custom DSL */
  CUSTOM: 'custom',
  /** Simple condition expression */
  EXPRESSION: 'expression',
} as const;

export type RuleFormatValue = (typeof RuleFormat)[keyof typeof RuleFormat];

/**
 * Policy scope types
 */
export const PolicyScope = {
  /** Applies to all decisions */
  GLOBAL: 'GLOBAL',
  /** Applies to specific decision types */
  DECISION_TYPE: 'DECISION_TYPE',
  /** Applies to specific actors */
  ACTOR: 'ACTOR',
  /** Applies to specific contexts */
  CONTEXT: 'CONTEXT',
  /** Applies to specific artifacts */
  ARTIFACT: 'ARTIFACT',
  /** Custom scope */
  CUSTOM: 'CUSTOM',
} as const;

export type PolicyScopeValue = (typeof PolicyScope)[keyof typeof PolicyScope];

/**
 * Policy status
 */
export const PolicyStatus = {
  /** Policy is being drafted */
  DRAFT: 'DRAFT',
  /** Policy is active and being enforced */
  ACTIVE: 'ACTIVE',
  /** Policy is temporarily disabled */
  SUSPENDED: 'SUSPENDED',
  /** Policy is no longer in use */
  DEPRECATED: 'DEPRECATED',
  /** Policy has been superseded by a newer version */
  SUPERSEDED: 'SUPERSEDED',
} as const;

export type PolicyStatusValue = (typeof PolicyStatus)[keyof typeof PolicyStatus];

/**
 * Scope definition for a policy
 */
export interface PolicyScopeDefinition {
  /** Type of scope */
  readonly type: PolicyScopeValue;
  /** Pattern to match (e.g., decision type pattern, actor ID pattern) */
  readonly pattern?: string;
  /** Specific IDs this scope applies to */
  readonly targetIds?: readonly ContentAddress[];
  /** Additional scope conditions */
  readonly conditions?: Record<string, unknown>;
}

/**
 * Activation window for policy versioning
 */
export interface ActivationWindow {
  /** When this policy version becomes active */
  readonly activatesAt: Timestamp;
  /** When this policy version expires (if applicable) */
  readonly expiresAt?: Timestamp;
  /** Timezone for activation (default: UTC) */
  readonly timezone?: string;
}

/**
 * Complete policy definition
 */
export interface PolicyDefinition {
  /** Human-readable policy name */
  readonly name: string;
  /** Detailed description of what this policy enforces */
  readonly description: string;
  /** Scope definition - what this policy applies to */
  readonly scope: PolicyScopeDefinition;
  /** The policy rule */
  readonly rule: PolicyRule;
  /** Enforcement mode when rule is violated */
  readonly enforcement: EnforcementModeValue;
  /** Policy version (semver recommended) */
  readonly version: string;
  /** Current status */
  readonly status: PolicyStatusValue;
  /** Activation window */
  readonly activation: ActivationWindow;
  /** Tags for categorization */
  readonly tags?: readonly string[];
  /** Priority when multiple policies apply (higher = more priority) */
  readonly priority?: number;
  /** ID of the policy this supersedes */
  readonly supersedesId?: ContentAddress;
  /** Additional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Policy rule definition
 */
export interface PolicyRule {
  /** Rule format/language */
  readonly format: RuleFormatValue;
  /** The rule expression/code */
  readonly expression: string;
  /** Human-readable explanation of the rule */
  readonly explanation?: string;
  /** Example inputs that should pass */
  readonly passingExamples?: readonly PolicyRuleExample[];
  /** Example inputs that should fail */
  readonly failingExamples?: readonly PolicyRuleExample[];
}

/**
 * Example for policy rule testing
 */
export interface PolicyRuleExample {
  /** Description of this example */
  readonly description: string;
  /** Input data for the rule */
  readonly input: Record<string, unknown>;
  /** Expected outcome */
  readonly expectedResult: boolean;
}

/**
 * Context snapshot for policy evaluation
 */
export interface PolicyEvaluationContext {
  /** The decision being evaluated */
  readonly decision: {
    readonly id: ContentAddress;
    readonly type: string;
    readonly action: Record<string, unknown>;
  };
  /** The actor making the decision */
  readonly actor: {
    readonly id: ContentAddress;
    readonly type: string;
    readonly authorities: readonly string[];
  };
  /** Referenced context nodes */
  readonly contexts: readonly {
    readonly id: ContentAddress;
    readonly data: unknown;
  }[];
  /** Current timestamp */
  readonly timestamp: Timestamp;
  /** Additional evaluation context */
  readonly extra?: Record<string, unknown>;
}

/**
 * Policy evaluation input
 */
export interface PolicyEvaluationInput {
  /** The policy to evaluate */
  readonly policy: PolicyDefinition;
  /** The context for evaluation */
  readonly context: PolicyEvaluationContext;
}

/**
 * Validate a policy definition
 */
export function validatePolicyDefinition(
  policy: Partial<PolicyDefinition>
): { valid: boolean; errors: readonly string[] } {
  const errors: string[] = [];

  if (!policy.name || policy.name.trim().length === 0) {
    errors.push('Policy name is required');
  }

  if (!policy.scope) {
    errors.push('Policy scope is required');
  } else if (!Object.values(PolicyScope).includes(policy.scope.type)) {
    errors.push(`Invalid scope type: ${policy.scope.type}`);
  }

  if (!policy.rule) {
    errors.push('Policy rule is required');
  } else {
    if (!Object.values(RuleFormat).includes(policy.rule.format)) {
      errors.push(`Invalid rule format: ${policy.rule.format}`);
    }
    if (!policy.rule.expression || policy.rule.expression.trim().length === 0) {
      errors.push('Rule expression is required');
    }
  }

  if (!policy.enforcement) {
    errors.push('Enforcement mode is required');
  } else if (!Object.values(EnforcementMode).includes(policy.enforcement)) {
    errors.push(`Invalid enforcement mode: ${policy.enforcement}`);
  }

  if (!policy.version) {
    errors.push('Policy version is required');
  }

  if (!policy.activation) {
    errors.push('Activation window is required');
  } else if (!policy.activation.activatesAt) {
    errors.push('Activation timestamp is required');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a policy is currently active
 */
export function isPolicyActive(
  policy: PolicyDefinition,
  asOf: Timestamp = new Date().toISOString()
): boolean {
  if (policy.status !== 'ACTIVE') {
    return false;
  }

  const activationTime = new Date(policy.activation.activatesAt).getTime();
  const asOfTime = new Date(asOf).getTime();

  if (asOfTime < activationTime) {
    return false;
  }

  if (policy.activation.expiresAt) {
    const expiryTime = new Date(policy.activation.expiresAt).getTime();
    if (asOfTime >= expiryTime) {
      return false;
    }
  }

  return true;
}

/**
 * Compare policy versions
 */
export function comparePolicyVersions(a: string, b: string): number {
  const parseVersion = (v: string): number[] => {
    return v.split('.').map((n) => parseInt(n, 10) || 0);
  };

  const vA = parseVersion(a);
  const vB = parseVersion(b);
  const maxLen = Math.max(vA.length, vB.length);

  for (let i = 0; i < maxLen; i++) {
    const numA = vA[i] ?? 0;
    const numB = vB[i] ?? 0;
    if (numA !== numB) {
      return numA - numB;
    }
  }

  return 0;
}

/**
 * Create a policy builder for fluent policy creation
 */
export function createPolicyBuilder(): PolicyBuilder {
  return new PolicyBuilder();
}

/**
 * Mutable policy type for builder
 */
interface MutablePolicy {
  name?: string;
  description?: string;
  scope?: PolicyScopeDefinition;
  rule?: PolicyRule;
  enforcement?: EnforcementModeValue;
  version?: string;
  status?: PolicyStatusValue;
  activation?: ActivationWindow;
  tags?: readonly string[];
  priority?: number;
  supersedesId?: ContentAddress;
  metadata?: Record<string, unknown>;
}

/**
 * Fluent builder for policy definitions
 */
export class PolicyBuilder {
  private policy: MutablePolicy = {
    status: 'DRAFT',
  };

  name(name: string): this {
    this.policy.name = name;
    return this;
  }

  description(description: string): this {
    this.policy.description = description;
    return this;
  }

  scope(scope: PolicyScopeDefinition): this {
    this.policy.scope = scope;
    return this;
  }

  globalScope(): this {
    this.policy.scope = { type: 'GLOBAL' };
    return this;
  }

  decisionTypeScope(pattern: string): this {
    this.policy.scope = { type: 'DECISION_TYPE', pattern };
    return this;
  }

  actorScope(actorIds: readonly ContentAddress[]): this {
    this.policy.scope = { type: 'ACTOR', targetIds: actorIds };
    return this;
  }

  rule(format: RuleFormatValue, expression: string, explanation?: string): this {
    this.policy.rule = explanation !== undefined
      ? { format, expression, explanation }
      : { format, expression };
    return this;
  }

  expressionRule(expression: string, explanation?: string): this {
    return this.rule('expression', expression, explanation);
  }

  enforcement(mode: EnforcementModeValue): this {
    this.policy.enforcement = mode;
    return this;
  }

  block(): this {
    return this.enforcement('BLOCK');
  }

  annotate(): this {
    return this.enforcement('ANNOTATE');
  }

  escalate(): this {
    return this.enforcement('ESCALATE');
  }

  shadow(): this {
    return this.enforcement('SHADOW');
  }

  version(version: string): this {
    this.policy.version = version;
    return this;
  }

  status(status: PolicyStatusValue): this {
    this.policy.status = status;
    return this;
  }

  activate(): this {
    this.policy.status = 'ACTIVE';
    return this;
  }

  activation(window: ActivationWindow): this {
    this.policy.activation = window;
    return this;
  }

  activateNow(): this {
    this.policy.activation = { activatesAt: new Date().toISOString() };
    return this.activate();
  }

  activateAt(timestamp: Timestamp, expiresAt?: Timestamp): this {
    const window: ActivationWindow = { activatesAt: timestamp };
    if (expiresAt !== undefined) {
      (window as { expiresAt: Timestamp }).expiresAt = expiresAt;
    }
    this.policy.activation = window;
    return this;
  }

  priority(priority: number): this {
    this.policy.priority = priority;
    return this;
  }

  tags(...tags: string[]): this {
    this.policy.tags = tags;
    return this;
  }

  supersedes(policyId: ContentAddress): this {
    this.policy.supersedesId = policyId;
    return this;
  }

  metadata(data: Record<string, unknown>): this {
    this.policy.metadata = data;
    return this;
  }

  build(): PolicyDefinition {
    const validation = validatePolicyDefinition(this.policy);
    if (!validation.valid) {
      throw new Error(`Invalid policy: ${validation.errors.join(', ')}`);
    }
    return this.policy as PolicyDefinition;
  }

  buildDraft(): Partial<PolicyDefinition> {
    return { ...this.policy };
  }
}
