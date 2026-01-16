/**
 * Backward Provenance Tracer for ContextGraph OS
 *
 * Implements EPIC 2 Capability 2.1:
 * T2.1.1 Trace Decision → Context → Inputs
 * T2.1.2 Include policy evaluation nodes in lineage
 * T2.1.3 Capture alternative paths when available
 *
 * Backward provenance answers: "Why was this outcome produced?"
 * by tracing from a decision/artifact back to its originating context.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { GraphNode, NodeTypeValue } from '../core/types/node.js';
import type { GraphEdge, EdgeTypeValue } from '../core/types/edge.js';
import type { Timestamp } from '../core/time/temporal.js';

/**
 * A node in the provenance trace with its lineage information
 */
export interface ProvenanceNode {
  /** The actual graph node */
  readonly node: GraphNode;
  /** Depth from the starting node (0 = starting node) */
  readonly depth: number;
  /** Edge that led to this node */
  readonly incomingEdge?: GraphEdge;
  /** All parent nodes that contributed to this node */
  readonly parentIds: readonly ContentAddress[];
}

/**
 * Complete backward provenance trace result
 */
export interface BackwardTraceResult {
  /** The starting node (outcome being traced) */
  readonly origin: GraphNode;
  /** All nodes in the trace, ordered by depth (breadth-first) */
  readonly nodes: readonly ProvenanceNode[];
  /** All edges in the trace */
  readonly edges: readonly GraphEdge[];
  /** Root context nodes (nodes with no further provenance) */
  readonly roots: readonly GraphNode[];
  /** Policy verdicts that affected the outcome */
  readonly policyVerdicts: readonly GraphNode[];
  /** Alternative decisions that were considered */
  readonly alternatives: readonly GraphNode[];
  /** Timestamp when the trace was computed */
  readonly tracedAt: Timestamp;
  /** Maximum depth reached */
  readonly maxDepth: number;
}

/**
 * Options for backward provenance tracing
 */
export interface BackwardTraceOptions {
  /** Maximum depth to trace (default: 10) */
  readonly maxDepth?: number;
  /** Edge types to follow (default: all provenance-related) */
  readonly followEdgeTypes?: readonly EdgeTypeValue[];
  /** Whether to include alternative paths (default: true) */
  readonly includeAlternatives?: boolean;
  /** Whether to include policy verdicts (default: true) */
  readonly includePolicyVerdicts?: boolean;
  /** Filter by timestamp - only include nodes valid at this time */
  readonly asOfTimestamp?: Timestamp;
}

/**
 * Default edge types for backward provenance tracing
 */
export const BACKWARD_PROVENANCE_EDGES: readonly EdgeTypeValue[] = [
  'DERIVED_FROM',
  'REFERENCES',
  'GOVERNED_BY',
  'APPROVED_BY',
  'CREATED_BY',
  'EVALUATES',
  'ALTERNATIVE_TO',
] as const;

/**
 * Interface for graph storage that the tracer needs
 */
export interface GraphReader {
  /** Get a node by ID */
  getNode(id: ContentAddress): Promise<GraphNode | null>;
  /** Get all edges where the given node is the source */
  getOutgoingEdges(nodeId: ContentAddress): Promise<readonly GraphEdge[]>;
  /** Get all edges where the given node is the target */
  getIncomingEdges(nodeId: ContentAddress): Promise<readonly GraphEdge[]>;
  /** Get edges of a specific type from a node */
  getEdgesByType(
    nodeId: ContentAddress,
    edgeType: EdgeTypeValue,
    direction: 'incoming' | 'outgoing'
  ): Promise<readonly GraphEdge[]>;
}

/**
 * Backward Provenance Tracer
 *
 * Traces the lineage of a decision or artifact back to its
 * originating context, including all policy evaluations and
 * alternative paths considered.
 */
export class BackwardProvenanceTracer {
  private readonly graph: GraphReader;
  private readonly defaultOptions: BackwardTraceOptions = {
    maxDepth: 10,
    followEdgeTypes: BACKWARD_PROVENANCE_EDGES,
    includeAlternatives: true,
    includePolicyVerdicts: true,
  };

  constructor(graph: GraphReader) {
    this.graph = graph;
  }

  /**
   * Trace backward from a node to find its provenance
   */
  async trace(
    startNodeId: ContentAddress,
    options: BackwardTraceOptions = {}
  ): Promise<BackwardTraceResult> {
    const opts = { ...this.defaultOptions, ...options };
    const startNode = await this.graph.getNode(startNodeId);

    if (!startNode) {
      throw new Error(`Node not found: ${startNodeId}`);
    }

    const visited = new Set<ContentAddress>();
    const nodeMap = new Map<ContentAddress, ProvenanceNode>();
    const edges: GraphEdge[] = [];
    const roots: GraphNode[] = [];
    const policyVerdicts: GraphNode[] = [];
    const alternatives: GraphNode[] = [];

    // BFS queue: [nodeId, depth, incomingEdge]
    const queue: Array<[ContentAddress, number, GraphEdge | undefined]> = [
      [startNodeId, 0, undefined],
    ];

    while (queue.length > 0) {
      const [currentId, depth, incomingEdge] = queue.shift()!;

      if (visited.has(currentId)) {
        continue;
      }

      if (depth > (opts.maxDepth ?? 10)) {
        continue;
      }

      visited.add(currentId);

      const node = await this.graph.getNode(currentId);
      if (!node) {
        continue;
      }

      // Apply timestamp filter if specified
      if (opts.asOfTimestamp !== undefined) {
        if (
          node.validity.validFrom > opts.asOfTimestamp ||
          (node.validity.validUntil !== undefined &&
            node.validity.validUntil <= opts.asOfTimestamp)
        ) {
          continue;
        }
      }

      // Get parent nodes through incoming edges
      const parentIds: ContentAddress[] = [];
      const incomingEdges = await this.getProvenanceEdges(currentId, opts);

      let hasProvenance = false;
      for (const edge of incomingEdges) {
        if (!visited.has(edge.sourceId)) {
          parentIds.push(edge.sourceId);
          edges.push(edge);
          queue.push([edge.sourceId, depth + 1, edge]);
          hasProvenance = true;
        }
      }

      // Create provenance node entry
      const provenanceNode: ProvenanceNode =
        incomingEdge !== undefined
          ? { node, depth, incomingEdge, parentIds }
          : { node, depth, parentIds };
      nodeMap.set(currentId, provenanceNode);

      // Categorize special nodes
      if (!hasProvenance && depth > 0) {
        roots.push(node);
      }

      if (node.type === 'VERDICT' && opts.includePolicyVerdicts) {
        policyVerdicts.push(node);
      }

      // Find alternatives if enabled
      if (opts.includeAlternatives && node.type === 'DECISION') {
        const alternativeEdges = await this.graph.getEdgesByType(
          currentId,
          'ALTERNATIVE_TO',
          'outgoing'
        );
        for (const altEdge of alternativeEdges) {
          if (!visited.has(altEdge.targetId)) {
            const altNode = await this.graph.getNode(altEdge.targetId);
            if (altNode) {
              alternatives.push(altNode);
              edges.push(altEdge);
            }
          }
        }
      }
    }

    // Convert map to array, sorted by depth
    const nodes = Array.from(nodeMap.values()).sort((a, b) => a.depth - b.depth);

    return {
      origin: startNode,
      nodes,
      edges,
      roots,
      policyVerdicts,
      alternatives,
      tracedAt: new Date().toISOString(),
      maxDepth: Math.max(...nodes.map((n) => n.depth), 0),
    };
  }

  /**
   * Get the minimal sufficient explanation for an outcome
   *
   * This filters the full trace to only include nodes that are
   * strictly necessary to explain the outcome.
   */
  async getMinimalExplanation(
    startNodeId: ContentAddress,
    options: BackwardTraceOptions = {}
  ): Promise<BackwardTraceResult> {
    const fullTrace = await this.trace(startNodeId, options);

    // Filter to only include:
    // 1. The origin
    // 2. Direct context references
    // 3. Policy verdicts that affected the decision
    // 4. Approval nodes

    const minimalNodeTypes: readonly NodeTypeValue[] = [
      'DECISION',
      'CONTEXT',
      'VERDICT',
      'APPROVAL',
      'POLICY',
    ];

    const minimalNodes = fullTrace.nodes.filter((pn) =>
      minimalNodeTypes.includes(pn.node.type)
    );

    const minimalNodeIds = new Set(minimalNodes.map((pn) => pn.node.id));

    const minimalEdges = fullTrace.edges.filter(
      (e) => minimalNodeIds.has(e.sourceId) && minimalNodeIds.has(e.targetId)
    );

    return {
      ...fullTrace,
      nodes: minimalNodes,
      edges: minimalEdges,
    };
  }

  /**
   * Get provenance edges for backward tracing
   */
  private async getProvenanceEdges(
    nodeId: ContentAddress,
    options: BackwardTraceOptions
  ): Promise<readonly GraphEdge[]> {
    const edgeTypes = options.followEdgeTypes ?? BACKWARD_PROVENANCE_EDGES;
    const allEdges: GraphEdge[] = [];

    for (const edgeType of edgeTypes) {
      // For backward provenance, we follow edges where the current node
      // is the target (to find sources/causes)
      const incoming = await this.graph.getEdgesByType(nodeId, edgeType, 'incoming');

      // Some edges need to be followed in the opposite direction
      // (e.g., DERIVED_FROM: if A is derived from B, trace to B)
      if (edgeType === 'DERIVED_FROM' || edgeType === 'REFERENCES') {
        const outgoing = await this.graph.getEdgesByType(nodeId, edgeType, 'outgoing');
        allEdges.push(...outgoing);
      } else {
        allEdges.push(...incoming);
      }
    }

    return allEdges;
  }
}

/**
 * Create a backward provenance tracer
 */
export function createBackwardTracer(graph: GraphReader): BackwardProvenanceTracer {
  return new BackwardProvenanceTracer(graph);
}
