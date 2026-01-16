/**
 * Policy Linter CLI for ContextGraph OS
 *
 * Implements EPIC 10 Capability 10.2:
 * T10.2.1 Policy linting rules
 * T10.2.2 Integration with CI/CD
 *
 * Bad policies cause bad decisions. Lint early, lint often.
 */

import type { ContentAddress } from '../src/core/identity/content-address.js';
import type { PolicyDefinition } from '../src/policy/schema.js';
import { ConflictResolver } from '../src/safety/conflict-resolver.js';

/**
 * Lint rule severity
 */
export const LintSeverity = {
  /** Error - must fix */
  ERROR: 'error',
  /** Warning - should fix */
  WARNING: 'warning',
  /** Info - consider fixing */
  INFO: 'info',
} as const;

export type LintSeverityValue = (typeof LintSeverity)[keyof typeof LintSeverity];

/**
 * Lint rule definition
 */
export interface LintRule {
  /** Rule ID */
  readonly id: string;
  /** Rule name */
  readonly name: string;
  /** Rule description */
  readonly description: string;
  /** Severity */
  readonly severity: LintSeverityValue;
  /** Category */
  readonly category: 'structure' | 'security' | 'performance' | 'best-practice' | 'conflict';
  /** Check function */
  readonly check: (
    policy: PolicyDefinition,
    allPolicies: readonly PolicyDefinition[]
  ) => LintIssue[];
}

/**
 * Lint issue
 */
export interface LintIssue {
  /** Rule that triggered the issue */
  readonly ruleId: string;
  /** Severity */
  readonly severity: LintSeverityValue;
  /** Policy ID */
  readonly policyId: ContentAddress;
  /** Policy name */
  readonly policyName: string;
  /** Issue message */
  readonly message: string;
  /** Suggestion for fix */
  readonly suggestion?: string;
  /** Line/location (if applicable) */
  readonly location?: string;
}

/**
 * Lint result
 */
export interface LintResult {
  /** Total policies checked */
  readonly policiesChecked: number;
  /** Total issues found */
  readonly totalIssues: number;
  /** Issues by severity */
  readonly bySeverity: {
    readonly errors: number;
    readonly warnings: number;
    readonly infos: number;
  };
  /** All issues */
  readonly issues: readonly LintIssue[];
  /** Whether linting passed (no errors) */
  readonly passed: boolean;
  /** Summary message */
  readonly summary: string;
}

/**
 * Lint configuration
 */
export interface LintConfig {
  /** Rules to enable/disable */
  readonly rules: Record<string, boolean | LintSeverityValue>;
  /** Treat warnings as errors */
  readonly warningsAsErrors?: boolean;
  /** Ignore patterns */
  readonly ignore?: readonly string[];
}

/**
 * Default lint rules
 */
export const DEFAULT_LINT_RULES: readonly LintRule[] = [
  // Structure rules
  {
    id: 'no-empty-name',
    name: 'No Empty Name',
    description: 'Policies must have a non-empty name',
    severity: LintSeverity.ERROR,
    category: 'structure',
    check: (policy) => {
      if (!policy.name || policy.name.trim() === '') {
        return [
          {
            ruleId: 'no-empty-name',
            severity: LintSeverity.ERROR,
            policyId: policy.id,
            policyName: policy.name || '<unnamed>',
            message: 'Policy name is empty',
            suggestion: 'Provide a descriptive name for the policy',
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'no-empty-rule',
    name: 'No Empty Rule',
    description: 'Policies should have a non-empty rule expression',
    severity: LintSeverity.WARNING,
    category: 'structure',
    check: (policy) => {
      if (!policy.rule || !policy.rule.expression || policy.rule.expression.trim() === '') {
        return [
          {
            ruleId: 'no-empty-rule',
            severity: LintSeverity.WARNING,
            policyId: policy.id,
            policyName: policy.name,
            message: 'Policy has no rule expression and will match everything',
            suggestion: 'Add a rule expression to define policy behavior',
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'valid-scope-pattern',
    name: 'Valid Scope Pattern',
    description: 'Scope patterns must be valid',
    severity: LintSeverity.ERROR,
    category: 'structure',
    check: (policy) => {
      const pattern = policy.scope.pattern;
      if (pattern && pattern.includes('**')) {
        return [
          {
            ruleId: 'valid-scope-pattern',
            severity: LintSeverity.ERROR,
            policyId: policy.id,
            policyName: policy.name,
            message: 'Invalid scope pattern: double wildcards not supported',
            suggestion: 'Use single wildcard (*) for matching',
          },
        ];
      }
      return [];
    },
  },

  // Security rules
  {
    id: 'no-global-allow',
    name: 'No Global Allow',
    description: 'Avoid global ANNOTATE/SHADOW policies without scope conditions',
    severity: LintSeverity.WARNING,
    category: 'security',
    check: (policy) => {
      const isGlobal = policy.scope.type === 'GLOBAL' || policy.scope.pattern === '*';
      const isPermissive = policy.enforcement === 'ANNOTATE' || policy.enforcement === 'SHADOW';
      const hasNoScopeConditions =
        !policy.scope.conditions || Object.keys(policy.scope.conditions).length === 0;

      if (isGlobal && isPermissive && hasNoScopeConditions) {
        return [
          {
            ruleId: 'no-global-allow',
            severity: LintSeverity.WARNING,
            policyId: policy.id,
            policyName: policy.name,
            message: 'Global permissive policy without scope conditions may be too broad',
            suggestion: 'Add scope conditions or narrow the scope pattern',
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'sensitive-scope-requires-escalate',
    name: 'Sensitive Scope Requires Escalate',
    description: 'Sensitive scopes should use ESCALATE or BLOCK enforcement',
    severity: LintSeverity.WARNING,
    category: 'security',
    check: (policy) => {
      const sensitivePatterns = ['financial:', 'personal:', 'auth:', 'admin:'];
      const scope = policy.scope.pattern ?? '';
      const isSensitive = sensitivePatterns.some((p) => scope.startsWith(p));
      const isRestrictive = policy.enforcement === 'BLOCK' || policy.enforcement === 'ESCALATE';

      if (isSensitive && !isRestrictive) {
        return [
          {
            ruleId: 'sensitive-scope-requires-escalate',
            severity: LintSeverity.WARNING,
            policyId: policy.id,
            policyName: policy.name,
            message: `Sensitive scope "${scope}" should use BLOCK or ESCALATE enforcement`,
            suggestion: 'Change enforcement to ESCALATE or BLOCK',
          },
        ];
      }
      return [];
    },
  },

  // Best practice rules
  {
    id: 'description-recommended',
    name: 'Description Recommended',
    description: 'Policies should have a description',
    severity: LintSeverity.INFO,
    category: 'best-practice',
    check: (policy) => {
      if (!policy.description || policy.description.trim() === '') {
        return [
          {
            ruleId: 'description-recommended',
            severity: LintSeverity.INFO,
            policyId: policy.id,
            policyName: policy.name,
            message: 'Policy has no description',
            suggestion: 'Add a description explaining the policy purpose',
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'version-recommended',
    name: 'Version Recommended',
    description: 'Policies should have a version',
    severity: LintSeverity.INFO,
    category: 'best-practice',
    check: (policy) => {
      if (!policy.version) {
        return [
          {
            ruleId: 'version-recommended',
            severity: LintSeverity.INFO,
            policyId: policy.id,
            policyName: policy.name,
            message: 'Policy has no version',
            suggestion: 'Add a version for tracking changes',
          },
        ];
      }
      return [];
    },
  },

  // Performance rules
  {
    id: 'overly-broad-scope',
    name: 'Overly Broad Scope',
    description: 'Warn about very broad scope patterns',
    severity: LintSeverity.INFO,
    category: 'performance',
    check: (policy) => {
      const pattern = policy.scope.pattern ?? '';
      const parts = pattern.split(':');
      const wildcardCount = parts.filter((p) => p === '*').length;

      if (wildcardCount > 2) {
        return [
          {
            ruleId: 'overly-broad-scope',
            severity: LintSeverity.INFO,
            policyId: policy.id,
            policyName: policy.name,
            message: `Scope pattern "${pattern}" has ${wildcardCount} wildcards`,
            suggestion: 'Consider narrowing the scope for better performance',
          },
        ];
      }
      return [];
    },
  },
];

/**
 * Policy Linter
 */
export class PolicyLinter {
  private rules: Map<string, LintRule> = new Map();
  private config: LintConfig;
  private conflictResolver: ConflictResolver;

  constructor(config: LintConfig = { rules: {} }) {
    this.config = config;
    this.conflictResolver = new ConflictResolver();

    // Register default rules
    for (const rule of DEFAULT_LINT_RULES) {
      this.registerRule(rule);
    }

    // Add conflict detection rule
    this.registerRule({
      id: 'no-conflicts',
      name: 'No Policy Conflicts',
      description: 'Detect conflicting policies',
      severity: LintSeverity.ERROR,
      category: 'conflict',
      check: (policy, allPolicies) => this.checkConflicts(policy, allPolicies),
    });
  }

  /**
   * Register a custom lint rule
   */
  registerRule(rule: LintRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Lint a single policy
   */
  lintPolicy(
    policy: PolicyDefinition,
    allPolicies: readonly PolicyDefinition[] = []
  ): readonly LintIssue[] {
    const issues: LintIssue[] = [];

    for (const [ruleId, rule] of this.rules) {
      // Check if rule is disabled
      if (this.config.rules[ruleId] === false) {
        continue;
      }

      // Check if ignored
      if (this.isIgnored(policy)) {
        continue;
      }

      // Run the rule
      const ruleIssues = rule.check(policy, allPolicies);

      // Apply severity override from config
      const configSeverity = this.config.rules[ruleId];
      if (typeof configSeverity === 'string') {
        for (const issue of ruleIssues) {
          issues.push({ ...issue, severity: configSeverity });
        }
      } else {
        issues.push(...ruleIssues);
      }
    }

    // Upgrade warnings to errors if configured
    if (this.config.warningsAsErrors) {
      return issues.map((issue) =>
        issue.severity === LintSeverity.WARNING ? { ...issue, severity: LintSeverity.ERROR } : issue
      );
    }

    return issues;
  }

  /**
   * Lint multiple policies
   */
  lint(policies: readonly PolicyDefinition[]): LintResult {
    const allIssues: LintIssue[] = [];

    for (const policy of policies) {
      const issues = this.lintPolicy(policy, policies);
      allIssues.push(...issues);
    }

    const errors = allIssues.filter((i) => i.severity === LintSeverity.ERROR).length;
    const warnings = allIssues.filter((i) => i.severity === LintSeverity.WARNING).length;
    const infos = allIssues.filter((i) => i.severity === LintSeverity.INFO).length;

    const passed = errors === 0;

    let summary: string;
    if (allIssues.length === 0) {
      summary = `Linted ${policies.length} policies - no issues found`;
    } else {
      summary = `Linted ${policies.length} policies - found ${errors} error(s), ${warnings} warning(s), ${infos} info(s)`;
    }

    return {
      policiesChecked: policies.length,
      totalIssues: allIssues.length,
      bySeverity: { errors, warnings, infos },
      issues: allIssues,
      passed,
      summary,
    };
  }

  /**
   * Format lint result for console output
   */
  formatResult(result: LintResult, verbose: boolean = false): string {
    const lines: string[] = [];

    if (result.issues.length > 0) {
      // Group issues by policy
      const byPolicy = new Map<string, LintIssue[]>();
      for (const issue of result.issues) {
        const key = `${issue.policyId}:${issue.policyName}`;
        const existing = byPolicy.get(key) ?? [];
        existing.push(issue);
        byPolicy.set(key, existing);
      }

      for (const [key, issues] of byPolicy) {
        lines.push(`\n${key}`);
        for (const issue of issues) {
          const icon = issue.severity === 'error' ? '✖' : issue.severity === 'warning' ? '⚠' : 'ℹ';
          lines.push(`  ${icon} ${issue.message} (${issue.ruleId})`);
          if (verbose && issue.suggestion) {
            lines.push(`    → ${issue.suggestion}`);
          }
        }
      }
    }

    lines.push('');
    lines.push(result.summary);

    if (!result.passed) {
      lines.push('');
      lines.push('Linting failed. Please fix the errors above.');
    }

    return lines.join('\n');
  }

  /**
   * Format result as JSON for CI/CD
   */
  formatResultJSON(result: LintResult): string {
    return JSON.stringify(result, null, 2);
  }

  /**
   * Format result as SARIF for GitHub integration
   */
  formatResultSARIF(result: LintResult): string {
    const sarif = {
      $schema:
        'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'ContextGraph Policy Linter',
              version: '0.1.0',
              rules: Array.from(this.rules.values()).map((rule) => ({
                id: rule.id,
                name: rule.name,
                shortDescription: { text: rule.description },
                defaultConfiguration: {
                  level:
                    rule.severity === 'error'
                      ? 'error'
                      : rule.severity === 'warning'
                        ? 'warning'
                        : 'note',
                },
              })),
            },
          },
          results: result.issues.map((issue) => ({
            ruleId: issue.ruleId,
            level:
              issue.severity === 'error'
                ? 'error'
                : issue.severity === 'warning'
                  ? 'warning'
                  : 'note',
            message: { text: issue.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: `policy/${issue.policyId}` },
                },
              },
            ],
          })),
        },
      ],
    };

    return JSON.stringify(sarif, null, 2);
  }

  // Private helpers

  private isIgnored(policy: PolicyDefinition): boolean {
    if (!this.config.ignore) {
      return false;
    }

    for (const pattern of this.config.ignore) {
      if (policy.name.includes(pattern) || policy.id.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  private checkConflicts(
    policy: PolicyDefinition,
    allPolicies: readonly PolicyDefinition[]
  ): LintIssue[] {
    const issues: LintIssue[] = [];

    // Register all policies
    for (const p of allPolicies) {
      this.conflictResolver.registerPolicy(p);
    }

    // Detect conflicts
    const conflicts = this.conflictResolver.detectConflicts();

    // Find conflicts involving this policy
    for (const conflict of conflicts) {
      if (conflict.policies.some((p) => p.id === policy.id)) {
        issues.push({
          ruleId: 'no-conflicts',
          severity: LintSeverity.ERROR,
          policyId: policy.id,
          policyName: policy.name,
          message: `Policy conflicts with "${conflict.policies.find((p) => p.id !== policy.id)?.name}": ${conflict.description}`,
          suggestion: 'Review and resolve the policy conflict',
        });
      }
    }

    // Clear for next run
    this.conflictResolver.clearConflicts();

    return issues;
  }
}

/**
 * Create a policy linter
 */
export function createPolicyLinter(config?: LintConfig): PolicyLinter {
  return new PolicyLinter(config);
}

/**
 * CLI main function
 */
export async function main(argv: string[]): Promise<number> {
  // Parse arguments
  const verbose = argv.includes('--verbose') || argv.includes('-v');
  const format = argv.includes('--json') ? 'json' : argv.includes('--sarif') ? 'sarif' : 'text';
  const warningsAsErrors = argv.includes('--strict');

  // In a real implementation, would load policies from files
  const policies: PolicyDefinition[] = [];

  // Create linter
  const linter = createPolicyLinter({
    rules: {},
    warningsAsErrors,
  });

  // Run lint
  const result = linter.lint(policies);

  // Output result
  if (format === 'json') {
    console.log(linter.formatResultJSON(result));
  } else if (format === 'sarif') {
    console.log(linter.formatResultSARIF(result));
  } else {
    console.log(linter.formatResult(result, verbose));
  }

  return result.passed ? 0 : 1;
}
