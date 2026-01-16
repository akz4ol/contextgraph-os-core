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

// Human-in-the-Loop exports
export * from './hitl/index.js';

// Query & Audit exports (renamed TimeRange to AuditTimeRange)
export {
  AuditEngine,
  AuditReportType,
  ExportFormat,
  createAuditEngine,
  type AuditReport,
  type AuditQueryParams,
  type AuditReportTypeValue,
  type ExportFormatValue,
  type TimeRange as AuditTimeRange,
} from './query/audit.js';
export * from './query/why-query.js';
export * from './query/replay.js';

// Agent SDK exports (renamed ContextValidationResult)
export {
  ContextAPI,
  createContextAPI,
  SDKContextType,
  type DeclaredContext,
  type DeclareContextInput,
  type SDKContextTypeValue,
  type ContextValidationResult as SDKContextValidationResult,
} from './sdk/context-api.js';
export * from './sdk/decision-api.js';
export * from './sdk/artifact-api.js';
export * from './sdk/visibility.js';
export { createAgentSDK, AgentPatterns, type AgentSDK } from './sdk/index.js';

// Safety & Failure Handling exports
export * from './safety/index.js';

// Version
export const VERSION = '0.1.0';
