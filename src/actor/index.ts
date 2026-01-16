/**
 * Actor & Authority Model for ContextGraph OS
 *
 * EPIC 5 - Every action has an owner.
 *
 * Provides:
 * - Actor Identity: Humans, agents, and systems are first-class actors
 * - Authority Scoping: Capabilities bound to policy scopes
 * - Non-Repudiation: Immutable attribution for all actions
 */

export * from './identity.js';
export * from './authority.js';
