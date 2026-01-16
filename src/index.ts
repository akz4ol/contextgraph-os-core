/**
 * ContextGraph OS
 *
 * Graph-native, event-sourced operating system for accountable AI agents.
 *
 * @packageDocumentation
 */

// Core module exports
export * from './core/index.js';

// Graph engine exports
export * from './graph/index.js';

// Provenance & Lineage exports
export * from './provenance/index.js';

// Policy Engine exports
export * from './policy/index.js';

// Decision Protocol exports
export * from './decision/index.js';

// Actor & Authority exports
export * from './actor/index.js';

// Version
export const VERSION = '0.1.0';
