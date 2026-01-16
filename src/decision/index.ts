/**
 * Decision Commitment Protocol for ContextGraph OS
 *
 * EPIC 4 - This is where "thinking" becomes "acting".
 *
 * Provides:
 * - Decision Lifecycle: proposed → evaluated → committed
 * - Atomic Transactions: A decision either fully exists or not at all
 * - Alternative Tracking: "Why not X?" is always answerable
 */

export * from './lifecycle.js';
export * from './alternatives.js';
