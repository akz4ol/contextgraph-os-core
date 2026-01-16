/**
 * Policy Evaluation Engine for ContextGraph OS
 *
 * EPIC 3 - Governance before autonomy.
 *
 * Provides:
 * - Policy as Data: Policies are first-class queryable objects
 * - Evaluation Pipeline: Pre-execution policy evaluation
 * - Enforcement Modes: BLOCK, ANNOTATE, ESCALATE, SHADOW
 */

export * from './schema.js';
export * from './evaluator.js';
export * from './enforcement.js';
