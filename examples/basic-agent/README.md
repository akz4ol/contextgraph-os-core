# Basic Agent Example

A simple example demonstrating how to build an accountable AI agent using ContextGraph OS.

## What This Example Shows

1. **Context Declaration** - How to declare and track context (user input, system state)
2. **Decision Proposal** - How to propose actions with full context tracking
3. **Policy Evaluation** - How policies control agent behavior
4. **Decision Lifecycle** - How decisions flow through proposed → evaluated → committed
5. **Artifact Registration** - How to track outputs produced by decisions

## Running the Example

From the repository root:

```bash
# Build the project first
npm run build

# Run the example
npx tsx examples/basic-agent/index.ts
```

## Key Concepts Demonstrated

### Context API
```typescript
// Declare user input
const userInput = sdk.context.declareUserInput(
  { request: 'Create a document' },
  'cli'
);

// Declare system state
const systemState = sdk.context.declareSystemState(
  { diskSpace: '500GB' },
  'system-monitor'
);
```

### Decision API
```typescript
// Build and propose an action
const proposal = sdk.decision.propose(
  sdk.decision.action()
    .withType('CREATE_DOCUMENT')
    .withParam('name', 'report.md')
    .build(),
  [userInput, systemState],
  'User requested document creation'
);
```

### Policy Evaluation
```typescript
// Define policies as data
const policy: PolicyDefinition = {
  name: 'Allow Document Creation',
  rule: {
    format: 'javascript',
    expression: 'decision.type === "CREATE_DOCUMENT"',
  },
  enforcement: 'BLOCK',
  // ...
};

// Evaluate against policies
const verdict = await policyEvaluator.evaluateAll(policies, context);
// verdict.result: 'ALLOW' | 'DENY' | 'ESCALATE' | 'ANNOTATE'
```

### Decision Lifecycle
```typescript
// Propose → Evaluate → Commit
const decision = await stateMachine.propose({ action, proposedBy, contextRefs });
const evaluated = await stateMachine.evaluate(decision.id, verdict);
const committed = await stateMachine.commit(decision.id);
```

### Artifact Registration
```typescript
// Track outputs
const artifact = sdk.artifact.registerData(
  { content: 'Document content' },
  decision.id,
  { description: 'Created document' }
);
```

## Expected Output

```
ContextGraph OS - Basic Agent Example
=====================================
Agent ID: sha256:...

Step 1: Declare Context
-----------------------
Declared user input context: sha256:...
Declared system state context: sha256:...

Step 2: Propose Decision
------------------------
Created proposal: proposal-1
Action type: CREATE_DOCUMENT
Context refs: 2

Step 3: Evaluate Against Policies
----------------------------------
Verdict result: ALLOW
Policies evaluated: 3
Blocking policies: 0
Escalating policies: 0

Step 4: Execute Decision Lifecycle
-----------------------------------
Decision proposed: sha256:...
State: PROPOSED
Decision evaluated: State = EVALUATED
Decision committed: State = COMMITTED
Concluded at: 2024-01-...

Step 5: Register Artifact
-------------------------
Artifact registered: sha256:...
Content hash: sha256:...
MIME type: application/json

Step 6: Display Statistics
--------------------------
Total contexts: 2
Active contexts: 2
Avg confidence: 1.00
Total proposals: 1

Demonstrating Policy Rejection
==============================
Proposed dangerous action: DELETE /etc/passwd
Verdict: DENY
Action BLOCKED by policy!
Violations: ...
Decision state: REJECTED

Example completed successfully!
```
