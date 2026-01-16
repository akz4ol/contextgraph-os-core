/**
 * Base Node Schema for ContextGraph OS
 *
 * Implements T1.1.1: Define base node schema (id, type, payload, timestamp)
 * Implements T1.1.4: Node versioning (new node per update)
 *
 * All nodes in ContextGraph are immutable. Updates create new node versions.
 */

import type { ContentAddress } from '../identity/content-address.js';
import type { Timestamp } from '../time/temporal.js';

/**
 * Node types in the ContextGraph
 * Implements T1.1.2: Node type registry
 */
export const NodeType = {
  /** Raw context from external sources */
  CONTEXT: 'CONTEXT',
  /** A decision made by an actor */
  DECISION: 'DECISION',
  /** A governance policy */
  POLICY: 'POLICY',
  /** A human, agent, or system */
  ACTOR: 'ACTOR',
  /** An output artifact */
  ARTIFACT: 'ARTIFACT',
  /** A policy evaluation verdict */
  VERDICT: 'VERDICT',
  /** An approval request or response */
  APPROVAL: 'APPROVAL',
} as const;

export type NodeTypeValue = (typeof NodeType)[keyof typeof NodeType];

/**
 * Node lifecycle states
 */
export const NodeStatus = {
  /** Node is active and valid */
  ACTIVE: 'ACTIVE',
  /** Node has been superseded by a newer version */
  SUPERSEDED: 'SUPERSEDED',
  /** Node has been invalidated */
  INVALIDATED: 'INVALIDATED',
} as const;

export type NodeStatusValue = (typeof NodeStatus)[keyof typeof NodeStatus];

/**
 * Base interface for all node payloads
 */
export interface BasePayload {
  /** Schema version for payload evolution */
  readonly schemaVersion: string;
}

/**
 * Context node payload
 */
export interface ContextPayload extends BasePayload {
  /** Source of the context (e.g., API, user input, sensor) */
  readonly source: string;
  /** The actual context data */
  readonly data: unknown;
  /** Content type (e.g., application/json, text/plain) */
  readonly contentType: string;
  /** Optional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Decision node payload
 */
export interface DecisionPayload extends BasePayload {
  /** The action being decided */
  readonly action: {
    readonly type: string;
    readonly parameters: Record<string, unknown>;
  };
  /** Decision lifecycle state */
  readonly lifecycle: 'PROPOSED' | 'EVALUATED' | 'COMMITTED' | 'REJECTED';
  /** Rationale for the decision */
  readonly rationale?: string;
  /** IDs of alternative decisions considered */
  readonly alternativeIds?: readonly ContentAddress[];
}

/**
 * Policy node payload
 */
export interface PolicyPayload extends BasePayload {
  /** Policy name */
  readonly name: string;
  /** Policy scope (what it applies to) */
  readonly scope: string;
  /** The policy rule (could be code, DSL, or declarative) */
  readonly rule: string;
  /** Rule language/format */
  readonly ruleFormat: 'javascript' | 'json-logic' | 'rego' | 'custom';
  /** Enforcement mode */
  readonly enforcement: 'BLOCK' | 'ANNOTATE' | 'ESCALATE' | 'SHADOW';
  /** Policy version for activation windows */
  readonly version: string;
}

/**
 * Actor node payload
 */
export interface ActorPayload extends BasePayload {
  /** Actor type */
  readonly actorType: 'HUMAN' | 'AGENT' | 'SYSTEM';
  /** Display name */
  readonly name: string;
  /** External identifier (e.g., email, agent ID) */
  readonly externalId?: string;
  /** Authority/permission scopes */
  readonly authorities: readonly string[];
}

/**
 * Artifact node payload
 */
export interface ArtifactPayload extends BasePayload {
  /** Artifact type */
  readonly artifactType: string;
  /** Content hash for integrity */
  readonly contentHash: string;
  /** Location/URI of the artifact */
  readonly location?: string | undefined;
  /** Size in bytes */
  readonly size?: number | undefined;
  /** MIME type */
  readonly mimeType?: string | undefined;
}

/**
 * Verdict node payload (policy evaluation result)
 */
export interface VerdictPayload extends BasePayload {
  /** The policy that was evaluated */
  readonly policyId: ContentAddress;
  /** The decision being evaluated */
  readonly decisionId: ContentAddress;
  /** Verdict result */
  readonly result: 'ALLOW' | 'DENY' | 'ESCALATE' | 'ANNOTATE';
  /** Explanation for the verdict */
  readonly explanation?: string;
  /** Additional annotations */
  readonly annotations?: readonly string[];
}

/**
 * Approval node payload
 */
export interface ApprovalPayload extends BasePayload {
  /** The decision requiring approval */
  readonly decisionId: ContentAddress;
  /** Approval status */
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** The actor who made the approval decision */
  readonly approverId?: ContentAddress;
  /** Justification text */
  readonly justification?: string;
  /** Approval expiry */
  readonly expiresAt?: Timestamp;
}

/**
 * Union type for all payload types
 */
export type NodePayload =
  | ContextPayload
  | DecisionPayload
  | PolicyPayload
  | ActorPayload
  | ArtifactPayload
  | VerdictPayload
  | ApprovalPayload;

/**
 * Validity window for temporal queries
 * Implements T1.3.1: Validity windows on nodes
 */
export interface ValidityWindow {
  /** When this node became valid */
  readonly validFrom: Timestamp;
  /** When this node ceased to be valid (undefined = still valid) */
  readonly validUntil?: Timestamp | undefined;
}

/**
 * Base node structure
 * All nodes in ContextGraph are immutable and content-addressed.
 */
export interface GraphNode<T extends NodePayload = NodePayload> {
  /** Content-addressed unique identifier */
  readonly id: ContentAddress;

  /** Node type from the registry */
  readonly type: NodeTypeValue;

  /** The node's payload data */
  readonly payload: T;

  /** When this node was created (event time) */
  readonly createdAt: Timestamp;

  /** Current status of the node */
  readonly status: NodeStatusValue;

  /** Temporal validity window */
  readonly validity: ValidityWindow;

  /** ID of the previous version (for versioned updates) */
  readonly previousVersionId?: ContentAddress;

  /** ID of the actor who created this node */
  readonly createdBy: ContentAddress;
}

/**
 * Type guard to check if a node is of a specific type
 */
export function isNodeOfType<T extends NodePayload>(
  node: GraphNode,
  type: NodeTypeValue
): node is GraphNode<T> {
  return node.type === type;
}

/**
 * Type-safe node creation input
 */
export interface CreateNodeInput<T extends NodePayload> {
  readonly type: NodeTypeValue;
  readonly payload: T;
  readonly createdBy: ContentAddress;
  readonly previousVersionId?: ContentAddress;
  readonly validFrom?: Timestamp;
  readonly validUntil?: Timestamp;
}
