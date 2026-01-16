# ContextGraph OS

> Graph-native, event-sourced operating system for accountable AI agents

[![CI](https://github.com/akz4ol/contextgraph-os/actions/workflows/ci.yml/badge.svg)](https://github.com/akz4ol/contextgraph-os/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue.svg)](https://www.typescriptlang.org/)

## Overview

ContextGraph OS is an infrastructure layer for AI agent systems that provides:

- **Immutable Context Graphs**: Every piece of context, decision, and action is stored as a node in a temporal graph
- **Complete Provenance**: Trace any outcome back to its originating context and forward to its impacts
- **Policy-First Governance**: Policies are first-class citizens evaluated before any agent action
- **Accountable Decisions**: Every decision captures alternatives considered, rationale, and approval chain
- **Human-in-the-Loop Controls**: Structured approval workflows and escalation paths

## Key Concepts

### Context Graph Engine
The heart of the system - a typed, temporal graph where:
- **Nodes** represent Context, Decisions, Policies, Actors, and Artifacts
- **Edges** encode semantic relationships (CAUSES, DERIVED_FROM, GOVERNED_BY, APPROVED_BY)
- All state changes are immutable, append-only events

### Provenance & Lineage
- **Backward Provenance**: "Why was this decision made?" - trace to originating context
- **Forward Impact**: "What did this affect?" - blast-radius analysis
- **Branch-Aware**: Exploration doesn't destroy accountability

### Policy Evaluation
Pre-execution governance with enforcement modes:
- **BLOCK**: Prevent execution
- **ANNOTATE**: Allow with warnings
- **ESCALATE**: Require human approval
- **SHADOW**: Observe-only (for policy development)

### Decision Protocol
Atomic, accountable decision lifecycle:
1. **Proposed**: Decision candidate created
2. **Evaluated**: Policies applied, verdict attached
3. **Committed**: Irreversibly recorded with full context

## Installation

```bash
npm install contextgraph-os
```

## Quick Start

```typescript
import { ContextGraph, Policy, Actor } from 'contextgraph-os';

// Initialize the graph
const graph = new ContextGraph();

// Register an actor (human or agent)
const actor = await graph.registerActor({
  type: 'agent',
  id: 'research-agent-001',
  authority: ['read:documents', 'propose:decisions']
});

// Define a policy
const policy = await graph.createPolicy({
  scope: 'financial-decisions',
  rule: 'amount > 10000 requires human approval',
  enforcement: 'ESCALATE'
});

// Agent proposes a decision with context
const decision = await graph.proposeDecision({
  actor: actor.id,
  context: contextSnapshot,
  action: { type: 'approve-expense', amount: 15000 },
  alternatives: [
    { action: 'reject', rationale: 'Over budget' },
    { action: 'defer', rationale: 'Await Q2 budget' }
  ]
});

// Decision is automatically evaluated against policies
// Since amount > 10000, it's escalated for human approval
console.log(decision.status); // 'pending-approval'
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent SDK                                │
│  Context Declaration │ Decision Proposal │ Artifact Registry │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Policy Evaluation Engine                   │
│        BLOCK │ ANNOTATE │ ESCALATE │ SHADOW                 │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                  Decision Commitment Protocol                │
│     Proposed → Evaluated → Committed (with alternatives)    │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    Context Graph Engine                      │
│   Typed Nodes │ Semantic Edges │ Temporal Validity          │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Event-Sourced Storage                      │
│           Immutable │ Append-Only │ Content-Addressed       │
└─────────────────────────────────────────────────────────────┘
```

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Architecture](./docs/architecture.md)
- [API Reference](./docs/api-reference.md)

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Security

For security issues, please see our [Security Policy](./SECURITY.md).

## License

Apache-2.0 - See [LICENSE](./LICENSE) for details.
