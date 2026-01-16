/**
 * Context Graph Engine for ContextGraph OS
 *
 * EPIC 1 - The heart of the system.
 * Provides typed nodes, semantic edges, and temporal queries.
 */

// Graph engine implementation will be added here
// For now, re-export core types needed for graph operations

export type {
  GraphNode,
  NodeTypeValue,
  NodePayload,
  CreateNodeInput,
} from '../core/types/node.js';

export type {
  GraphEdge,
  EdgeTypeValue,
  CreateEdgeInput,
} from '../core/types/edge.js';

export { NodeType, NodeStatus } from '../core/types/node.js';
export { EdgeType, validateEdgeTypes, getEdgeTypeRule } from '../core/types/edge.js';
