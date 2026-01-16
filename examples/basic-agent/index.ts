/**
 * Basic Agent Example
 *
 * Demonstrates how to build an accountable AI agent using ContextGraph OS.
 * This example shows:
 * - Context declaration
 * - Decision proposal and evaluation
 * - Policy-based access control
 * - Artifact registration
 */

import {
  createAgentSDK,
  createPolicyEvaluator,
  createDecisionStateMachine,
  computeContentAddress,
} from '../../src/index.js';
import type { PolicyDefinition, PolicyEvaluationContext } from '../../src/policy/schema.js';
import type { DeclaredContext } from '../../src/sdk/context-api.js';

// Create a unique agent identity
const agentId = computeContentAddress({
  type: 'agent',
  name: 'basic-example-agent',
  version: '1.0.0',
});

// Initialize the SDK
const sdk = createAgentSDK(agentId);
const policyEvaluator = createPolicyEvaluator();
const decisionStateMachine = createDecisionStateMachine();

console.log('ContextGraph OS - Basic Agent Example');
console.log('=====================================');
console.log(`Agent ID: ${agentId}\n`);

// Define policies
const policies: PolicyDefinition[] = [
  // Allow creating documents
  {
    id: computeContentAddress({ policy: 'allow-create-documents' }),
    name: 'Allow Document Creation',
    description: 'Allows agents to create documents',
    scope: { type: 'GLOBAL' },
    rule: {
      format: 'javascript',
      expression: 'decision.type === "CREATE_DOCUMENT"',
    },
    enforcement: 'BLOCK',
    version: '1.0.0',
    status: 'ACTIVE',
    activation: {
      activatesAt: new Date(Date.now() - 86400000).toISOString(),
    },
  },
  // Escalate large file operations
  {
    id: computeContentAddress({ policy: 'escalate-large-files' }),
    name: 'Escalate Large Files',
    description: 'Requires approval for files over 10MB',
    scope: { type: 'GLOBAL' },
    rule: {
      format: 'javascript',
      expression: '!extra.sizeBytes || extra.sizeBytes < 10000000',
    },
    enforcement: 'ESCALATE',
    version: '1.0.0',
    status: 'ACTIVE',
    activation: {
      activatesAt: new Date(Date.now() - 86400000).toISOString(),
    },
  },
  // Block system file deletion
  {
    id: computeContentAddress({ policy: 'block-system-delete' }),
    name: 'Block System File Deletion',
    description: 'Prevents deletion of system files',
    scope: { type: 'GLOBAL' },
    rule: {
      format: 'javascript',
      expression: '!(decision.type === "DELETE" && extra.path && extra.path.startsWith("/etc"))',
    },
    enforcement: 'BLOCK',
    version: '1.0.0',
    status: 'ACTIVE',
    activation: {
      activatesAt: new Date(Date.now() - 86400000).toISOString(),
    },
  },
];

/**
 * Simulate an agent performing a task
 */
async function simulateAgentTask(): Promise<void> {
  console.log('Step 1: Declare Context');
  console.log('-----------------------');

  // Declare user input context
  const userInput = sdk.context.declareUserInput(
    { request: 'Create a new document called report.md', timestamp: new Date().toISOString() },
    'cli'
  );
  console.log(`Declared user input context: ${userInput.id}`);

  // Declare system state context
  const systemState = sdk.context.declareSystemState(
    { diskSpace: '500GB', memory: '16GB', os: 'Linux' },
    'system-monitor'
  );
  console.log(`Declared system state context: ${systemState.id}`);

  console.log('\nStep 2: Propose Decision');
  console.log('------------------------');

  // Create a proposal
  const proposal = sdk.decision.propose(
    sdk.decision
      .action()
      .withType('CREATE_DOCUMENT')
      .withParam('name', 'report.md')
      .withParam('content', '# Report\n\nThis is a test document.')
      .build(),
    [userInput, systemState],
    'User requested document creation'
  );
  console.log(`Created proposal: ${proposal.id}`);
  console.log(`Action type: ${proposal.action.type}`);
  console.log(`Context refs: ${proposal.contextRefs.length}`);

  console.log('\nStep 3: Evaluate Against Policies');
  console.log('----------------------------------');

  // Create evaluation context
  const evalContext = createEvaluationContext(proposal, [userInput, systemState]);

  // Evaluate policies
  const verdict = await policyEvaluator.evaluateAll(policies, evalContext);
  console.log(`Verdict result: ${verdict.result}`);
  console.log(`Policies evaluated: ${verdict.policyResults.length}`);
  console.log(`Blocking policies: ${verdict.blockingPolicies.length}`);
  console.log(`Escalating policies: ${verdict.escalatingPolicies.length}`);

  console.log('\nStep 4: Execute Decision Lifecycle');
  console.log('-----------------------------------');

  // Propose in state machine
  const decision = await decisionStateMachine.propose({
    action: proposal.action,
    proposedBy: agentId,
    contextRefs: proposal.contextRefs,
    rationale: proposal.rationale,
  });
  console.log(`Decision proposed: ${decision.id}`);
  console.log(`State: ${decision.state}`);

  // Evaluate
  const evaluated = await decisionStateMachine.evaluate(decision.id, verdict);
  console.log(`Decision evaluated: State = ${evaluated.state}`);

  // Commit if allowed
  if (evaluated.state === 'EVALUATED') {
    const committed = await decisionStateMachine.commit(decision.id);
    console.log(`Decision committed: State = ${committed.state}`);
    console.log(`Concluded at: ${committed.concludedAt}`);

    console.log('\nStep 5: Register Artifact');
    console.log('-------------------------');

    // Register the created artifact
    const artifact = sdk.artifact.registerData(
      { content: '# Report\n\nThis is a test document.', format: 'markdown' },
      decision.id,
      { description: 'Created document', tags: ['document', 'markdown'] }
    );
    console.log(`Artifact registered: ${artifact.id}`);
    console.log(`Content hash: ${artifact.contentHash}`);
    console.log(`MIME type: ${artifact.mimeType}`);
  } else {
    console.log(`Decision was not approved: ${evaluated.state}`);
  }

  console.log('\nStep 6: Display Statistics');
  console.log('--------------------------');

  // Show context stats
  const contextStats = sdk.context.getStats();
  console.log(`Total contexts: ${contextStats.total}`);
  console.log(`Active contexts: ${contextStats.active}`);
  console.log(`Avg confidence: ${contextStats.avgConfidence.toFixed(2)}`);

  // Show proposal stats
  const allProposals = sdk.decision.getAllProposals();
  console.log(`Total proposals: ${allProposals.length}`);
}

/**
 * Demonstrate policy rejection
 */
async function simulatePolicyRejection(): Promise<void> {
  console.log('\n\nDemonstrating Policy Rejection');
  console.log('==============================');

  // Declare context for a dangerous operation
  const userInput = sdk.context.declareUserInput(
    { request: 'Delete system configuration', path: '/etc/passwd' },
    'cli'
  );

  // Propose dangerous action
  const proposal = sdk.decision.propose(
    sdk.decision.action().withType('DELETE').withParam('path', '/etc/passwd').build(),
    [userInput],
    'User requested file deletion'
  );

  console.log(`Proposed dangerous action: DELETE ${'/etc/passwd'}`);

  // Evaluate
  const evalContext = createEvaluationContext(proposal, [userInput]);
  (evalContext.extra as Record<string, unknown>).path = '/etc/passwd';

  const verdict = await policyEvaluator.evaluateAll(policies, evalContext);
  console.log(`Verdict: ${verdict.result}`);

  if (verdict.result === 'DENY') {
    console.log('Action BLOCKED by policy!');
    console.log(`Violations: ${verdict.violations.map((v) => v.message).join(', ')}`);
  }

  // Propose in state machine
  const decision = await decisionStateMachine.propose({
    action: proposal.action,
    proposedBy: agentId,
    contextRefs: proposal.contextRefs,
  });

  // Evaluate - should auto-reject
  const rejected = await decisionStateMachine.evaluate(decision.id, verdict);
  console.log(`Decision state: ${rejected.state}`);
}

// Helper function to create evaluation context
function createEvaluationContext(
  proposal: ReturnType<typeof sdk.decision.propose>,
  contexts: DeclaredContext[]
): PolicyEvaluationContext {
  return {
    decision: {
      id: proposal.id,
      type: proposal.action.type,
      action: {
        operation: proposal.action.type,
        target: String(proposal.action.parameters.name ?? 'unknown'),
      },
    },
    actor: {
      id: agentId,
      type: 'AGENT',
      authorities: ['basic'],
    },
    contexts: contexts.map((c) => ({ id: c.id, data: c.data })),
    timestamp: new Date().toISOString(),
    extra: {},
  };
}

// Run the example
async function main(): Promise<void> {
  try {
    await simulateAgentTask();
    await simulatePolicyRejection();
    console.log('\n\nExample completed successfully!');
  } catch (error) {
    console.error('Error running example:', error);
    process.exit(1);
  }
}

main();
