/**
 * Provenance & Lineage Engine for ContextGraph OS
 *
 * EPIC 2 - This is what regulators, auditors, and incident responders care about.
 *
 * Provides:
 * - Backward Provenance: Trace Decision → Context → Inputs
 * - Forward Impact: Trace Context → Decisions → Artifacts
 * - Branch-Aware Lineage: Preserve exploration without destroying accountability
 */

export * from './backward-trace.js';
export * from './forward-impact.js';
export * from './branch-lineage.js';
