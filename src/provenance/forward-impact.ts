/**
 * Forward Impact Analysis for ContextGraph OS
 *
 * Implements EPIC 2 Capability 2.2:
 * T2.2.1 Trace Context → Decisions → Artifacts
 * T2.2.2 Support blast-radius analysis
 * T2.2.3 Detect cascading effects
 *
 * Forward impact answers: "What did this context/decision affect?"
 * by tracing from a source to all downstream decisions and artifacts.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { GraphNode, NodeTypeValue } from '../core/types/node.js';
import type { GraphEdge, EdgeTypeValue } from '../core/types/edge.js';
import type { Timestamp } from '../core/time/temporal.js';
import type { GraphReader } from './backward-trace.js';

/**
 * An impacted node with its relationship to the source
 */
export interface ImpactedNode {
  /** The affected graph node */
  readonly node: GraphNode;
  /** Distance from the source (1 = directly affected) */
  readonly distance: number;
  /** Edge that caused this impact */
  readonly causingEdge: GraphEdge;
  /** Impact chain showing how this node was reached */
  readonly impactChain: readonly ContentAddress[];
  /** Severity of impact (direct, cascading, transitive) */
  readonly impactType: 'direct' | 'cascading' | 'transitive';
}

/**
 * Blast radius analysis result
 */
export interface BlastRadiusResult {
  /** The source node being analyzed */
  readonly source: GraphNode;
  /** All directly impacted nodes */
  readonly directImpacts: readonly ImpactedNode[];
  /** All cascading impacts (indirect through decisions) */
  readonly cascadingImpacts: readonly ImpactedNode[];
  /** All transitive impacts (further downstream) */
  readonly transitiveImpacts: readonly ImpactedNode[];
  /** Total number of affected nodes */
  readonly totalAffectedCount: number;
  /** Affected nodes by type */
  readonly affectedByType: Record<NodeTypeValue, number>;
  /** Maximum cascade depth */
  readonly maxCascadeDepth: number;
  /** Timestamp when analysis was computed */
  readonly analyzedAt: Timestamp;
}

/**
 * Cascading effect detection result
 */
export interface CascadeEffect {
  /** The decision that triggered the cascade */
  readonly trigger: GraphNode;
  /** Chain of effects */
  readonly effectChain: readonly GraphNode[];
  /** Final outcomes */
  readonly outcomes: readonly GraphNode[];
  /** Whether this cascade crossed policy boundaries */
  readonly crossesPolicyBoundary: boolean;
}

/**
 * Options for forward impact analysis
 */
export interface ForwardImpactOptions {
  /** Maximum depth to trace (default: 10) */
  readonly maxDepth?: number;
  /** Edge types to follow (default: all impact-related) */
  readonly followEdgeTypes?: readonly EdgeTypeValue[];
  /** Node types to include in results (default: all) */
  readonly includeNodeTypes?: readonly NodeTypeValue[];
  /** Filter by timestamp - only include nodes valid at this time */
  readonly asOfTimestamp?: Timestamp;
  /** Stop at decisions (don't trace through to artifacts) */
  readonly stopAtDecisions?: boolean;
}

/**
 * Default edge types for forward impact tracing
 */
export const FORWARD_IMPACT_EDGES: readonly EdgeTypeValue[] = [
  'CAUSES',
  'PRODUCES',
  'DERIVED_FROM', // Reverse direction for impact
  'REFERENCES', // Reverse direction for impact
] as const;

/**
 * Forward Impact Analyzer
 *
 * Analyzes the downstream impact of a context or decision,
 * including blast-radius analysis and cascade detection.
 */
export class ForwardImpactAnalyzer {
  private readonly graph: GraphReader;
  private readonly defaultOptions: ForwardImpactOptions = {
    maxDepth: 10,
    followEdgeTypes: FORWARD_IMPACT_EDGES,
    stopAtDecisions: false,
  };

  constructor(graph: GraphReader) {
    this.graph = graph;
  }

  /**
   * Analyze the forward impact of a node
   */
  async analyzeBlastRadius(
    sourceNodeId: ContentAddress,
    options: ForwardImpactOptions = {}
  ): Promise<BlastRadiusResult> {
    const opts = { ...this.defaultOptions, ...options };
    const sourceNode = await this.graph.getNode(sourceNodeId);

    if (!sourceNode) {
      throw new Error(`Node not found: ${sourceNodeId}`);
    }

    const visited = new Set<ContentAddress>();
    const directImpacts: ImpactedNode[] = [];
    const cascadingImpacts: ImpactedNode[] = [];
    const transitiveImpacts: ImpactedNode[] = [];
    const affectedByType: Record<string, number> = {};

    // BFS queue: [nodeId, distance, impactChain, causingEdge]
    const queue: Array<
      [ContentAddress, number, ContentAddress[], GraphEdge | undefined]
    > = [[sourceNodeId, 0, [], undefined]];

    visited.add(sourceNodeId);

    while (queue.length > 0) {
      const [currentId, distance, chain, causingEdge] = queue.shift()!;

      if (distance > (opts.maxDepth ?? 10)) {
        continue;
      }

      const node = await this.graph.getNode(currentId);
      if (!node) {
        continue;
      }

      // Apply timestamp filter
      if (opts.asOfTimestamp !== undefined) {
        if (
          node.validity.validFrom > opts.asOfTimestamp ||
          (node.validity.validUntil !== undefined &&
            node.validity.validUntil <= opts.asOfTimestamp)
        ) {
          continue;
        }
      }

      // Apply node type filter
      if (
        opts.includeNodeTypes !== undefined &&
        opts.includeNodeTypes.length > 0 &&
        !opts.includeNodeTypes.includes(node.type)
      ) {
        continue;
      }

      // Stop at decisions if configured
      if (opts.stopAtDecisions && node.type === 'DECISION' && distance > 0) {
        if (causingEdge) {
          directImpacts.push({
            node,
            distance,
            causingEdge,
            impactChain: chain,
            impactType: 'direct',
          });
        }
        continue;
      }

      // Record impact (skip source node)
      if (distance > 0 && causingEdge) {
        const impactType = this.classifyImpactType(distance, chain);
        const impactedNode: ImpactedNode = {
          node,
          distance,
          causingEdge,
          impactChain: chain,
          impactType,
        };

        switch (impactType) {
          case 'direct':
            directImpacts.push(impactedNode);
            break;
          case 'cascading':
            cascadingImpacts.push(impactedNode);
            break;
          case 'transitive':
            transitiveImpacts.push(impactedNode);
            break;
        }

        // Count by type
        affectedByType[node.type] = (affectedByType[node.type] ?? 0) + 1;
      }

      // Get downstream nodes
      const outgoingEdges = await this.getImpactEdges(currentId, opts);

      for (const edge of outgoingEdges) {
        const targetId = edge.targetId === currentId ? edge.sourceId : edge.targetId;
        if (!visited.has(targetId)) {
          visited.add(targetId);
          queue.push([targetId, distance + 1, [...chain, currentId], edge]);
        }
      }
    }

    const maxCascadeDepth = Math.max(
      ...directImpacts.map((i) => i.distance),
      ...cascadingImpacts.map((i) => i.distance),
      ...transitiveImpacts.map((i) => i.distance),
      0
    );

    return {
      source: sourceNode,
      directImpacts,
      cascadingImpacts,
      transitiveImpacts,
      totalAffectedCount:
        directImpacts.length + cascadingImpacts.length + transitiveImpacts.length,
      affectedByType: affectedByType as Record<NodeTypeValue, number>,
      maxCascadeDepth,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Detect cascading effects from a decision
   */
  async detectCascades(
    decisionId: ContentAddress,
    options: ForwardImpactOptions = {}
  ): Promise<readonly CascadeEffect[]> {
    const blastRadius = await this.analyzeBlastRadius(decisionId, options);
    const cascades: CascadeEffect[] = [];

    // Find decision chains (decision → decision → ...)
    const decisionImpacts = [
      ...blastRadius.directImpacts,
      ...blastRadius.cascadingImpacts,
      ...blastRadius.transitiveImpacts,
    ].filter((i) => i.node.type === 'DECISION');

    // Group by cascade chains
    const chainMap = new Map<string, ImpactedNode[]>();

    for (const impact of decisionImpacts) {
      const chainKey = impact.impactChain.join('→');
      const existing = chainMap.get(chainKey) ?? [];
      existing.push(impact);
      chainMap.set(chainKey, existing);
    }

    // Build cascade effects
    for (const [, impacts] of chainMap) {
      if (impacts.length === 0) {
        continue;
      }

      const trigger = blastRadius.source;
      const effectChain = impacts.map((i) => i.node);

      // Find outcomes (artifacts produced by final decisions)
      const outcomes: GraphNode[] = [];
      const finalDecision = effectChain[effectChain.length - 1];
      if (finalDecision) {
        const producedEdges = await this.graph.getEdgesByType(
          finalDecision.id,
          'PRODUCES',
          'outgoing'
        );
        for (const edge of producedEdges) {
          const artifact = await this.graph.getNode(edge.targetId);
          if (artifact) {
            outcomes.push(artifact);
          }
        }
      }

      // Check if cascade crosses policy boundaries
      const crossesPolicyBoundary = await this.checkPolicyBoundaryCrossing(
        effectChain
      );

      cascades.push({
        trigger,
        effectChain,
        outcomes,
        crossesPolicyBoundary,
      });
    }

    return cascades;
  }

  /**
   * Get what-if impact analysis
   *
   * Estimates the impact if a node were to be invalidated or changed.
   */
  async whatIfInvalidated(
    nodeId: ContentAddress,
    options: ForwardImpactOptions = {}
  ): Promise<BlastRadiusResult> {
    // Same as blast radius, but useful for planning
    return this.analyzeBlastRadius(nodeId, options);
  }

  /**
   * Classify the type of impact based on distance and chain
   */
  private classifyImpactType(
    distance: number,
    chain: readonly ContentAddress[]
  ): 'direct' | 'cascading' | 'transitive' {
    if (distance === 1) {
      return 'direct';
    }
    if (distance <= 3 && chain.length <= 3) {
      return 'cascading';
    }
    return 'transitive';
  }

  /**
   * Get impact edges for forward tracing
   */
  private async getImpactEdges(
    nodeId: ContentAddress,
    options: ForwardImpactOptions
  ): Promise<readonly GraphEdge[]> {
    const edgeTypes = options.followEdgeTypes ?? FORWARD_IMPACT_EDGES;
    const allEdges: GraphEdge[] = [];

    for (const edgeType of edgeTypes) {
      // For forward impact, we follow edges where the current node is the source
      const outgoing = await this.graph.getEdgesByType(nodeId, edgeType, 'outgoing');
      allEdges.push(...outgoing);

      // Some edges need reverse direction
      // (e.g., if B is DERIVED_FROM A, then A impacts B)
      if (edgeType === 'DERIVED_FROM' || edgeType === 'REFERENCES') {
        const incoming = await this.graph.getEdgesByType(nodeId, edgeType, 'incoming');
        allEdges.push(...incoming);
      }
    }

    return allEdges;
  }

  /**
   * Check if a cascade crosses policy boundaries
   */
  private async checkPolicyBoundaryCrossing(
    effectChain: readonly GraphNode[]
  ): Promise<boolean> {
    const policySets = new Set<ContentAddress>();

    for (const node of effectChain) {
      if (node.type === 'DECISION') {
        // Get governing policies
        const governedByEdges = await this.graph.getEdgesByType(
          node.id,
          'GOVERNED_BY',
          'outgoing'
        );
        for (const edge of governedByEdges) {
          policySets.add(edge.targetId);
        }
      }
    }

    // If multiple different policies govern the chain, it crosses boundaries
    return policySets.size > 1;
  }
}

/**
 * Create a forward impact analyzer
 */
export function createForwardAnalyzer(graph: GraphReader): ForwardImpactAnalyzer {
  return new ForwardImpactAnalyzer(graph);
}
