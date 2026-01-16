/**
 * Edge Types and Semantics for ContextGraph OS
 *
 * Implements T1.2.1: Define edge types (CAUSES, DERIVED_FROM, GOVERNED_BY, APPROVED_BY)
 * Implements T1.2.2: Enforce directionality and cardinality rules
 */

import type { ContentAddress } from '../identity/content-address.js';
import type { Timestamp } from '../time/temporal.js';
import type { NodeTypeValue } from './node.js';

/**
 * Edge types in the ContextGraph
 * Each edge type has semantic meaning for provenance and lineage tracking.
 */
export const EdgeType = {
  /** Source node caused/led to target node */
  CAUSES: 'CAUSES',
  /** Target node was derived from source node */
  DERIVED_FROM: 'DERIVED_FROM',
  /** Target node is governed by source policy node */
  GOVERNED_BY: 'GOVERNED_BY',
  /** Target node was approved by source actor/approval node */
  APPROVED_BY: 'APPROVED_BY',
  /** Source actor created/owns target node */
  CREATED_BY: 'CREATED_BY',
  /** Target node supersedes source node (versioning) */
  SUPERSEDES: 'SUPERSEDES',
  /** Source decision references target context */
  REFERENCES: 'REFERENCES',
  /** Target artifact was produced by source decision */
  PRODUCES: 'PRODUCES',
  /** Source verdict evaluates target decision */
  EVALUATES: 'EVALUATES',
  /** Source node is an alternative to target node */
  ALTERNATIVE_TO: 'ALTERNATIVE_TO',
  /** Source escalation targets actor/group */
  ESCALATED_TO: 'ESCALATED_TO',
} as const;

export type EdgeTypeValue = (typeof EdgeType)[keyof typeof EdgeType];

/**
 * Edge cardinality constraints
 */
export const Cardinality = {
  /** One source to one target */
  ONE_TO_ONE: 'ONE_TO_ONE',
  /** One source to many targets */
  ONE_TO_MANY: 'ONE_TO_MANY',
  /** Many sources to one target */
  MANY_TO_ONE: 'MANY_TO_ONE',
  /** Many sources to many targets */
  MANY_TO_MANY: 'MANY_TO_MANY',
} as const;

export type CardinalityValue = (typeof Cardinality)[keyof typeof Cardinality];

/**
 * Edge type rules defining valid source/target node types and cardinality
 * Implements T1.2.4: Validate edge creation against node types
 */
export interface EdgeTypeRule {
  readonly edgeType: EdgeTypeValue;
  readonly validSourceTypes: readonly NodeTypeValue[];
  readonly validTargetTypes: readonly NodeTypeValue[];
  readonly cardinality: CardinalityValue;
  readonly description: string;
}

/**
 * Registry of edge type rules
 */
export const EDGE_TYPE_RULES: readonly EdgeTypeRule[] = [
  {
    edgeType: 'CAUSES',
    validSourceTypes: ['CONTEXT', 'DECISION', 'ARTIFACT'],
    validTargetTypes: ['DECISION', 'ARTIFACT', 'CONTEXT'],
    cardinality: 'MANY_TO_MANY',
    description: 'Source event/decision caused target outcome',
  },
  {
    edgeType: 'DERIVED_FROM',
    validSourceTypes: ['DECISION', 'CONTEXT', 'ARTIFACT'],
    validTargetTypes: ['CONTEXT', 'DECISION', 'ARTIFACT'],
    cardinality: 'MANY_TO_MANY',
    description: 'Target was derived from source data/decision',
  },
  {
    edgeType: 'GOVERNED_BY',
    validSourceTypes: ['DECISION'],
    validTargetTypes: ['POLICY'],
    cardinality: 'MANY_TO_MANY',
    description: 'Decision is governed by policy',
  },
  {
    edgeType: 'APPROVED_BY',
    validSourceTypes: ['DECISION'],
    validTargetTypes: ['ACTOR', 'APPROVAL'],
    cardinality: 'MANY_TO_MANY',
    description: 'Decision was approved by actor',
  },
  {
    edgeType: 'CREATED_BY',
    validSourceTypes: ['CONTEXT', 'DECISION', 'POLICY', 'ARTIFACT', 'VERDICT', 'APPROVAL'],
    validTargetTypes: ['ACTOR'],
    cardinality: 'MANY_TO_ONE',
    description: 'Node was created by actor',
  },
  {
    edgeType: 'SUPERSEDES',
    validSourceTypes: ['CONTEXT', 'DECISION', 'POLICY', 'ACTOR', 'ARTIFACT'],
    validTargetTypes: ['CONTEXT', 'DECISION', 'POLICY', 'ACTOR', 'ARTIFACT'],
    cardinality: 'ONE_TO_ONE',
    description: 'Source supersedes target (versioning)',
  },
  {
    edgeType: 'REFERENCES',
    validSourceTypes: ['DECISION'],
    validTargetTypes: ['CONTEXT'],
    cardinality: 'MANY_TO_MANY',
    description: 'Decision references context',
  },
  {
    edgeType: 'PRODUCES',
    validSourceTypes: ['DECISION'],
    validTargetTypes: ['ARTIFACT'],
    cardinality: 'ONE_TO_MANY',
    description: 'Decision produces artifact',
  },
  {
    edgeType: 'EVALUATES',
    validSourceTypes: ['VERDICT'],
    validTargetTypes: ['DECISION'],
    cardinality: 'MANY_TO_ONE',
    description: 'Verdict evaluates decision',
  },
  {
    edgeType: 'ALTERNATIVE_TO',
    validSourceTypes: ['DECISION'],
    validTargetTypes: ['DECISION'],
    cardinality: 'MANY_TO_MANY',
    description: 'Decision is alternative to another decision',
  },
  {
    edgeType: 'ESCALATED_TO',
    validSourceTypes: ['DECISION', 'APPROVAL'],
    validTargetTypes: ['ACTOR'],
    cardinality: 'MANY_TO_MANY',
    description: 'Decision/approval escalated to actor',
  },
] as const;

/**
 * Edge metadata for provenance tracking
 */
export interface EdgeMetadata {
  /** When this edge was created */
  readonly createdAt: Timestamp;
  /** Actor who created this edge */
  readonly createdBy: ContentAddress;
  /** Optional description/rationale */
  readonly description?: string;
  /** Additional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * A directed edge in the graph
 */
export interface GraphEdge {
  /** Unique identifier for this edge */
  readonly id: ContentAddress;
  /** Type of relationship */
  readonly type: EdgeTypeValue;
  /** Source node ID */
  readonly sourceId: ContentAddress;
  /** Target node ID */
  readonly targetId: ContentAddress;
  /** Edge metadata */
  readonly metadata: EdgeMetadata;
}

/**
 * Input for creating an edge
 */
export interface CreateEdgeInput {
  readonly type: EdgeTypeValue;
  readonly sourceId: ContentAddress;
  readonly targetId: ContentAddress;
  readonly createdBy: ContentAddress;
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Validation result for edge creation
 */
export interface EdgeValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Get the rule for an edge type
 */
export function getEdgeTypeRule(edgeType: EdgeTypeValue): EdgeTypeRule | undefined {
  return EDGE_TYPE_RULES.find((rule) => rule.edgeType === edgeType);
}

/**
 * Validate that an edge can be created between two node types
 */
export function validateEdgeTypes(
  edgeType: EdgeTypeValue,
  sourceNodeType: NodeTypeValue,
  targetNodeType: NodeTypeValue
): EdgeValidationResult {
  const rule = getEdgeTypeRule(edgeType);
  const errors: string[] = [];

  if (!rule) {
    errors.push(`Unknown edge type: ${edgeType}`);
    return { valid: false, errors };
  }

  if (!rule.validSourceTypes.includes(sourceNodeType)) {
    errors.push(
      `Invalid source node type '${sourceNodeType}' for edge type '${edgeType}'. ` +
        `Valid source types: ${rule.validSourceTypes.join(', ')}`
    );
  }

  if (!rule.validTargetTypes.includes(targetNodeType)) {
    errors.push(
      `Invalid target node type '${targetNodeType}' for edge type '${edgeType}'. ` +
        `Valid target types: ${rule.validTargetTypes.join(', ')}`
    );
  }

  return { valid: errors.length === 0, errors };
}
