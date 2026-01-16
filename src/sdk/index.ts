/**
 * Agent SDK for ContextGraph OS
 *
 * EPIC 8 - Build accountable agents with confidence.
 *
 * Provides:
 * - Context API: Declare what you know
 * - Decision API: Propose what you want to do
 * - Artifact API: Track what you produce
 * - Visibility: See only what you're permitted
 */

export * from './context-api.js';
export * from './decision-api.js';
export * from './artifact-api.js';
export * from './visibility.js';

import type { ContentAddress } from '../core/identity/content-address.js';
import type { ContextAPI} from './context-api.js';
import { createContextAPI } from './context-api.js';
import type { DecisionAPI} from './decision-api.js';
import { createDecisionAPI } from './decision-api.js';
import type { ArtifactAPI} from './artifact-api.js';
import { createArtifactAPI } from './artifact-api.js';
import type { VisibilityManager} from './visibility.js';
import { createVisibilityManager } from './visibility.js';

/**
 * Agent SDK - unified interface for building accountable agents
 */
export interface AgentSDK {
  /** Context declaration API */
  readonly context: ContextAPI;
  /** Decision proposal API */
  readonly decision: DecisionAPI;
  /** Artifact registration API */
  readonly artifact: ArtifactAPI;
  /** Visibility management */
  readonly visibility: VisibilityManager;
  /** The agent's actor ID */
  readonly actorId: ContentAddress;
}

/**
 * Create an Agent SDK instance
 *
 * @example
 * ```typescript
 * const sdk = createAgentSDK('agent-123');
 *
 * // Declare context
 * const userInput = sdk.context.declareUserInput({
 *   query: "What's the weather?",
 *   timestamp: Date.now()
 * });
 *
 * // Propose a decision
 * const proposal = sdk.decision.propose(
 *   sdk.decision.action()
 *     .withType('QUERY_WEATHER')
 *     .withParam('location', 'New York')
 *     .build(),
 *   [userInput],
 *   'User requested weather information'
 * );
 *
 * // Submit and check result
 * const result = await sdk.decision.submit(proposal.id);
 *
 * if (result.approved) {
 *   // Execute and register artifact
 *   const weatherData = await fetchWeather('New York');
 *   sdk.artifact.registerData(weatherData, result.proposal.id);
 * }
 * ```
 */
export function createAgentSDK(actorId: ContentAddress): AgentSDK {
  const context = createContextAPI(actorId);
  const decision = createDecisionAPI(actorId);
  const artifact = createArtifactAPI(actorId);
  const visibility = createVisibilityManager();

  return {
    context,
    decision,
    artifact,
    visibility,
    actorId,
  };
}

/**
 * Type-safe wrapper for common agent patterns
 */
export const AgentPatterns = {
  /**
   * Execute a task with full context tracking
   */
  async executeTask<TInput, TOutput>(
    sdk: AgentSDK,
    taskType: string,
    input: TInput,
    executor: (input: TInput) => Promise<TOutput>
  ): Promise<{
    success: boolean;
    output?: TOutput;
    decisionId?: string;
    error?: string;
  }> {
    // Declare input context
    const inputContext = sdk.context.declareUserInput(input, 'task-input');

    // Propose the task
    const proposal = sdk.decision.proposeAction(
      taskType,
      { input },
      [inputContext],
      `Execute task: ${taskType}`
    );

    // Submit for evaluation
    const result = await sdk.decision.submit(proposal.id);

    if (!result.approved) {
      return {
        success: false,
        decisionId: proposal.id,
        error: `Task not approved: ${result.feedback.map((f) => f.message).join(', ')}`,
      };
    }

    try {
      // Execute the task
      const output = await executor(input);

      // Register output as artifact
      sdk.artifact.registerData(
        output as object,
        proposal.id as ContentAddress,
        { description: `Output of ${taskType}` }
      );

      // Mark as executed
      await sdk.decision.execute(proposal.id);

      return {
        success: true,
        output,
        decisionId: proposal.id,
      };
    } catch (error) {
      return {
        success: false,
        decisionId: proposal.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Make a decision with alternatives tracking
   */
  async decideWithAlternatives<T>(
    sdk: AgentSDK,
    actionType: string,
    alternatives: Array<{ option: T; description: string }>,
    selector: (options: T[]) => Promise<{ selected: T; reason: string }>
  ): Promise<{
    selected: T;
    proposal: ReturnType<typeof sdk.decision.propose>;
    alternatives: Array<{ option: T; description: string }>;
  }> {
    // Declare alternatives as context
    const altContext = sdk.context.declare({
      type: 'CUSTOM',
      data: { alternatives: alternatives.map((a) => a.description) },
      source: 'decision-alternatives',
      tags: ['alternatives'],
    });

    // Let selector choose
    const { selected, reason } = await selector(alternatives.map((a) => a.option));

    // Propose the selected option
    const proposal = sdk.decision.propose(
      sdk.decision.action()
        .withType(actionType)
        .withParam('selection', selected)
        .build(),
      [altContext],
      reason
    );

    return {
      selected,
      proposal,
      alternatives,
    };
  },
};
