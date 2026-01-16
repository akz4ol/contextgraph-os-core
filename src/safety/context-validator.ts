/**
 * Context Validator for ContextGraph OS
 *
 * Implements EPIC 9 Capability 9.1:
 * T9.1.1 Detect missing context at decision time
 * T9.1.2 Flag decisions with insufficient inputs
 *
 * Garbage in, garbage out. Validate everything.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { DecisionAction, DecisionContextRef } from '../decision/lifecycle.js';

/**
 * Validation severity
 */
export const ValidationSeverity = {
  /** Information only */
  INFO: 'INFO',
  /** Warning - proceed with caution */
  WARNING: 'WARNING',
  /** Error - should not proceed */
  ERROR: 'ERROR',
  /** Critical - must not proceed */
  CRITICAL: 'CRITICAL',
} as const;

export type ValidationSeverityValue = (typeof ValidationSeverity)[keyof typeof ValidationSeverity];

/**
 * Context requirement definition
 */
export interface ContextRequirement {
  /** Requirement ID */
  readonly id: string;
  /** Description of what's required */
  readonly description: string;
  /** Context type required */
  readonly contextType: string;
  /** Whether this requirement is mandatory */
  readonly mandatory: boolean;
  /** Minimum confidence level */
  readonly minConfidence?: number;
  /** Maximum age in milliseconds */
  readonly maxAgeMs?: number;
  /** Validation function */
  readonly validator?: (context: unknown) => boolean;
}

/**
 * Context validation result
 */
export interface ContextValidationResult {
  /** Whether the context is valid */
  readonly valid: boolean;
  /** Overall severity */
  readonly severity: ValidationSeverityValue;
  /** Validation issues found */
  readonly issues: readonly ContextValidationIssue[];
  /** Missing requirements */
  readonly missingRequirements: readonly ContextRequirement[];
  /** Satisfied requirements */
  readonly satisfiedRequirements: readonly ContextRequirement[];
  /** Recommendations */
  readonly recommendations: readonly string[];
}

/**
 * A context validation issue
 */
export interface ContextValidationIssue {
  /** Issue ID */
  readonly id: string;
  /** Issue type */
  readonly type: 'missing' | 'stale' | 'low_confidence' | 'invalid' | 'insufficient';
  /** Severity */
  readonly severity: ValidationSeverityValue;
  /** Issue message */
  readonly message: string;
  /** Related requirement */
  readonly requirementId?: string;
  /** Related context */
  readonly contextId?: ContentAddress;
  /** Suggested fix */
  readonly suggestion?: string;
}

/**
 * Action requirement profile
 */
export interface ActionRequirementProfile {
  /** Action type */
  readonly actionType: string;
  /** Required contexts */
  readonly requirements: readonly ContextRequirement[];
  /** Minimum number of context references */
  readonly minContexts?: number;
  /** Custom validation function */
  readonly customValidator?: (action: DecisionAction, contexts: readonly ContextInfo[]) => ContextValidationIssue[];
}

/**
 * Context info for validation
 */
export interface ContextInfo {
  /** Context ID */
  readonly id: ContentAddress;
  /** Context type */
  readonly type: string;
  /** Confidence level */
  readonly confidence: number;
  /** When it was created */
  readonly createdAt: string;
  /** Data (for custom validation) */
  readonly data?: unknown;
}

/**
 * Context Validator
 *
 * Ensures decisions have sufficient context before proceeding.
 */
export class ContextValidator {
  private profiles: Map<string, ActionRequirementProfile> = new Map();
  private contextStore: Map<ContentAddress, ContextInfo> = new Map();
  private issueCounter = 0;

  /**
   * Register an action requirement profile
   */
  registerProfile(profile: ActionRequirementProfile): void {
    this.profiles.set(profile.actionType, profile);
  }

  /**
   * Register context info for validation
   */
  registerContext(info: ContextInfo): void {
    this.contextStore.set(info.id, info);
  }

  /**
   * Validate a decision's context
   */
  validate(
    action: DecisionAction,
    contextRefs: readonly DecisionContextRef[]
  ): ContextValidationResult {
    const issues: ContextValidationIssue[] = [];
    const missingRequirements: ContextRequirement[] = [];
    const satisfiedRequirements: ContextRequirement[] = [];
    const recommendations: string[] = [];

    // Get profile for this action type
    const profile = this.profiles.get(action.type);

    // Get context info for all refs
    const contexts: ContextInfo[] = contextRefs
      .map((ref) => this.contextStore.get(ref.contextId))
      .filter((c): c is ContextInfo => c !== undefined);

    // Check minimum contexts
    if (profile?.minContexts && contextRefs.length < profile.minContexts) {
      issues.push({
        id: `issue-${++this.issueCounter}`,
        type: 'insufficient',
        severity: ValidationSeverity.ERROR,
        message: `Action requires at least ${profile.minContexts} context(s), but only ${contextRefs.length} provided`,
        suggestion: 'Add more context references to the decision',
      });
    }

    // Check no context at all
    if (contextRefs.length === 0) {
      issues.push({
        id: `issue-${++this.issueCounter}`,
        type: 'missing',
        severity: ValidationSeverity.CRITICAL,
        message: 'Decision has no context references',
        suggestion: 'Every decision must reference at least one context',
      });
    }

    // Check requirements if profile exists
    if (profile) {
      for (const requirement of profile.requirements) {
        const matchingContexts = contexts.filter((c) => c.type === requirement.contextType);

        if (matchingContexts.length === 0) {
          if (requirement.mandatory) {
            missingRequirements.push(requirement);
            issues.push({
              id: `issue-${++this.issueCounter}`,
              type: 'missing',
              severity: ValidationSeverity.ERROR,
              message: `Missing required context: ${requirement.description}`,
              requirementId: requirement.id,
              suggestion: `Provide context of type '${requirement.contextType}'`,
            });
          } else {
            recommendations.push(`Consider providing context: ${requirement.description}`);
          }
          continue;
        }

        // Check each matching context
        let satisfied = false;
        for (const context of matchingContexts) {
          const contextIssues = this.validateContextAgainstRequirement(context, requirement);
          if (contextIssues.length === 0) {
            satisfied = true;
          } else {
            issues.push(...contextIssues);
          }
        }

        if (satisfied) {
          satisfiedRequirements.push(requirement);
        } else if (requirement.mandatory) {
          missingRequirements.push(requirement);
        }
      }

      // Run custom validator if present
      if (profile.customValidator) {
        const customIssues = profile.customValidator(action, contexts);
        issues.push(...customIssues);
      }
    }

    // Check for stale contexts
    const now = Date.now();
    for (const context of contexts) {
      const contextAge = now - new Date(context.createdAt).getTime();
      const maxAge = 24 * 60 * 60 * 1000; // Default 24 hours

      if (contextAge > maxAge) {
        issues.push({
          id: `issue-${++this.issueCounter}`,
          type: 'stale',
          severity: ValidationSeverity.WARNING,
          message: `Context ${context.id} is stale (age: ${Math.round(contextAge / 3600000)}h)`,
          contextId: context.id,
          suggestion: 'Consider refreshing this context',
        });
      }
    }

    // Check for low confidence
    for (const context of contexts) {
      if (context.confidence < 0.5) {
        issues.push({
          id: `issue-${++this.issueCounter}`,
          type: 'low_confidence',
          severity: ValidationSeverity.WARNING,
          message: `Context ${context.id} has low confidence (${context.confidence})`,
          contextId: context.id,
          suggestion: 'Verify this context or find a more reliable source',
        });
      }
    }

    // Determine overall validity and severity
    const hasCritical = issues.some((i) => i.severity === ValidationSeverity.CRITICAL);
    const hasError = issues.some((i) => i.severity === ValidationSeverity.ERROR);
    const hasWarning = issues.some((i) => i.severity === ValidationSeverity.WARNING);

    let severity: ValidationSeverityValue;
    if (hasCritical) {
      severity = ValidationSeverity.CRITICAL;
    } else if (hasError) {
      severity = ValidationSeverity.ERROR;
    } else if (hasWarning) {
      severity = ValidationSeverity.WARNING;
    } else {
      severity = ValidationSeverity.INFO;
    }

    const valid = !hasCritical && !hasError;

    return {
      valid,
      severity,
      issues,
      missingRequirements,
      satisfiedRequirements,
      recommendations,
    };
  }

  /**
   * Quick check if a decision has sufficient context
   */
  hasSufficientContext(
    action: DecisionAction,
    contextRefs: readonly DecisionContextRef[]
  ): boolean {
    const result = this.validate(action, contextRefs);
    return result.valid;
  }

  /**
   * Get requirements for an action type
   */
  getRequirements(actionType: string): readonly ContextRequirement[] {
    return this.profiles.get(actionType)?.requirements ?? [];
  }

  // Private helper methods

  private validateContextAgainstRequirement(
    context: ContextInfo,
    requirement: ContextRequirement
  ): ContextValidationIssue[] {
    const issues: ContextValidationIssue[] = [];

    // Check confidence
    if (requirement.minConfidence !== undefined && context.confidence < requirement.minConfidence) {
      issues.push({
        id: `issue-${++this.issueCounter}`,
        type: 'low_confidence',
        severity: requirement.mandatory ? ValidationSeverity.ERROR : ValidationSeverity.WARNING,
        message: `Context confidence (${context.confidence}) below required minimum (${requirement.minConfidence})`,
        requirementId: requirement.id,
        contextId: context.id,
      });
    }

    // Check age
    if (requirement.maxAgeMs !== undefined) {
      const age = Date.now() - new Date(context.createdAt).getTime();
      if (age > requirement.maxAgeMs) {
        issues.push({
          id: `issue-${++this.issueCounter}`,
          type: 'stale',
          severity: requirement.mandatory ? ValidationSeverity.ERROR : ValidationSeverity.WARNING,
          message: `Context age (${Math.round(age / 1000)}s) exceeds maximum (${Math.round(requirement.maxAgeMs / 1000)}s)`,
          requirementId: requirement.id,
          contextId: context.id,
        });
      }
    }

    // Run custom validator
    if (requirement.validator && context.data !== undefined) {
      const isValid = requirement.validator(context.data);
      if (!isValid) {
        issues.push({
          id: `issue-${++this.issueCounter}`,
          type: 'invalid',
          severity: requirement.mandatory ? ValidationSeverity.ERROR : ValidationSeverity.WARNING,
          message: `Context failed custom validation for requirement: ${requirement.description}`,
          requirementId: requirement.id,
          contextId: context.id,
        });
      }
    }

    return issues;
  }
}

/**
 * Create a context validator
 */
export function createContextValidator(): ContextValidator {
  return new ContextValidator();
}

/**
 * Common requirement profiles
 */
export const CommonProfiles: readonly ActionRequirementProfile[] = [
  {
    actionType: 'CREATE',
    requirements: [
      {
        id: 'create-authorization',
        description: 'Authorization to create',
        contextType: 'AUTHORIZATION',
        mandatory: true,
      },
      {
        id: 'create-data',
        description: 'Data to create',
        contextType: 'USER_INPUT',
        mandatory: true,
      },
    ],
    minContexts: 1,
  },
  {
    actionType: 'DELETE',
    requirements: [
      {
        id: 'delete-authorization',
        description: 'Authorization to delete',
        contextType: 'AUTHORIZATION',
        mandatory: true,
      },
      {
        id: 'delete-confirmation',
        description: 'User confirmation',
        contextType: 'USER_INPUT',
        mandatory: true,
      },
    ],
    minContexts: 2,
  },
  {
    actionType: 'TRANSFER',
    requirements: [
      {
        id: 'transfer-authorization',
        description: 'Authorization to transfer',
        contextType: 'AUTHORIZATION',
        mandatory: true,
      },
      {
        id: 'transfer-source',
        description: 'Transfer source',
        contextType: 'EXTERNAL_DATA',
        mandatory: true,
      },
      {
        id: 'transfer-destination',
        description: 'Transfer destination',
        contextType: 'USER_INPUT',
        mandatory: true,
      },
    ],
    minContexts: 3,
  },
];
