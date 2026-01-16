/**
 * Unit tests for Agent SDK
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  createAgentSDK,
  createContextAPI,
  createDecisionAPI,
  ContextAPI,
  DecisionAPI,
  SDKContextType,
  ProposalStatus,
  CommonActions,
} from '../../src/sdk/index.js';
import type { DeclaredContext, DeclareContextInput } from '../../src/sdk/context-api.js';
import type { DecisionVerdict } from '../../src/policy/evaluator.js';
import { computeContentAddress } from '../../src/core/identity/content-address.js';

describe('Agent SDK', () => {
  describe('createAgentSDK', () => {
    it('should create SDK with all APIs', () => {
      const actorId = computeContentAddress({ type: 'agent', name: 'test' });
      const sdk = createAgentSDK(actorId);

      expect(sdk.actorId).toBe(actorId);
      expect(sdk.context).toBeInstanceOf(ContextAPI);
      expect(sdk.decision).toBeInstanceOf(DecisionAPI);
      expect(sdk.artifact).toBeDefined();
      expect(sdk.visibility).toBeDefined();
    });
  });

  describe('Context API', () => {
    let contextAPI: ContextAPI;
    const actorId = computeContentAddress({ type: 'agent', name: 'test-agent' });

    beforeEach(() => {
      contextAPI = createContextAPI(actorId);
    });

    describe('declare', () => {
      it('should declare a new context', () => {
        const input: DeclareContextInput<{ query: string }> = {
          type: SDKContextType.USER_INPUT,
          data: { query: 'Hello' },
          source: 'user',
        };

        const context = contextAPI.declare(input);

        expect(context.id).toBeDefined();
        expect(context.type).toBe(SDKContextType.USER_INPUT);
        expect(context.data).toEqual({ query: 'Hello' });
        expect(context.source).toBe('user');
        expect(context.declaredBy).toBe(actorId);
        expect(context.confidence).toBe(1.0);
      });

      it('should set confidence level when provided', () => {
        const context = contextAPI.declare({
          type: SDKContextType.EXTERNAL_DATA,
          data: { value: 42 },
          source: 'api',
          confidence: 0.8,
        });

        expect(context.confidence).toBe(0.8);
      });

      it('should set tags when provided', () => {
        const context = contextAPI.declare({
          type: SDKContextType.CUSTOM,
          data: { custom: true },
          source: 'custom-source',
          tags: ['important', 'verified'],
        });

        expect(context.tags).toContain('important');
        expect(context.tags).toContain('verified');
      });

      it('should set expiry when TTL is provided', () => {
        const before = Date.now();
        const context = contextAPI.declare({
          type: SDKContextType.SYSTEM_STATE,
          data: { status: 'running' },
          source: 'system',
          ttlMs: 60000, // 1 minute
        });

        expect(context.expiresAt).toBeDefined();
        const expiryTime = new Date(context.expiresAt!).getTime();
        expect(expiryTime).toBeGreaterThan(before + 59000);
        expect(expiryTime).toBeLessThan(before + 61000);
      });

      it('should throw for invalid context', () => {
        expect(() =>
          contextAPI.declare({
            type: SDKContextType.USER_INPUT,
            data: null as unknown as object,
            source: 'test',
          })
        ).toThrow('Invalid context');
      });
    });

    describe('convenience methods', () => {
      it('should declare user input', () => {
        const context = contextAPI.declareUserInput({ message: 'Hi' }, 'cli');

        expect(context.type).toBe(SDKContextType.USER_INPUT);
        expect(context.source).toBe('cli');
        expect(context.confidence).toBe(1.0);
      });

      it('should declare external data', () => {
        const context = contextAPI.declareExternalData(
          { weather: 'sunny' },
          'weather-api',
          { confidence: 0.9, ttlMs: 300000 }
        );

        expect(context.type).toBe(SDKContextType.EXTERNAL_DATA);
        expect(context.source).toBe('weather-api');
        expect(context.confidence).toBe(0.9);
        expect(context.expiresAt).toBeDefined();
      });

      it('should declare system state', () => {
        const context = contextAPI.declareSystemState({ memory: '4GB' }, 'monitor');

        expect(context.type).toBe(SDKContextType.SYSTEM_STATE);
        expect(context.source).toBe('monitor');
      });

      it('should declare configuration', () => {
        const context = contextAPI.declareConfiguration({ maxRetries: 3 }, 'app-config');

        expect(context.type).toBe(SDKContextType.CONFIGURATION);
        expect(context.source).toBe('app-config');
      });
    });

    describe('get', () => {
      it('should retrieve a context by ID', () => {
        const declared = contextAPI.declareUserInput({ test: true });
        const retrieved = contextAPI.get(declared.id);

        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(declared.id);
        expect(retrieved?.data).toEqual({ test: true });
      });

      it('should return undefined for non-existent context', () => {
        const fakeId = computeContentAddress({ fake: true });
        const result = contextAPI.get(fakeId);

        expect(result).toBeUndefined();
      });

      it('should return undefined for expired context', async () => {
        const context = contextAPI.declare({
          type: SDKContextType.SYSTEM_STATE,
          data: { temp: true },
          source: 'test',
          ttlMs: 1, // Expires almost immediately
        });

        // Wait for expiry
        await new Promise((resolve) => setTimeout(resolve, 10));

        const result = contextAPI.get(context.id);
        expect(result).toBeUndefined();
      });
    });

    describe('query', () => {
      beforeEach(() => {
        // Seed some contexts
        contextAPI.declareUserInput({ msg: 'one' }, 'user');
        contextAPI.declareExternalData({ data: 'two' }, 'api');
        contextAPI.declare({
          type: SDKContextType.CUSTOM,
          data: { custom: true },
          source: 'custom',
          tags: ['special'],
        });
      });

      it('should query by type', () => {
        const results = contextAPI.query({ types: [SDKContextType.USER_INPUT] });
        expect(results).toHaveLength(1);
        expect(results[0].type).toBe(SDKContextType.USER_INPUT);
      });

      it('should query by source', () => {
        const results = contextAPI.query({ source: 'api' });
        expect(results).toHaveLength(1);
        expect(results[0].source).toBe('api');
      });

      it('should query by tags', () => {
        const results = contextAPI.query({ tags: ['special'] });
        expect(results).toHaveLength(1);
        expect(results[0].tags).toContain('special');
      });

      it('should limit results', () => {
        const results = contextAPI.query({ limit: 2 });
        expect(results).toHaveLength(2);
      });

      it('should filter by min confidence', () => {
        contextAPI.declare({
          type: SDKContextType.EXTERNAL_DATA,
          data: { uncertain: true },
          source: 'unsure',
          confidence: 0.3,
        });

        const results = contextAPI.query({ minConfidence: 0.5 });
        expect(results.every((c) => c.confidence >= 0.5)).toBe(true);
      });
    });

    describe('getByType and getByTag', () => {
      it('should get contexts by type', () => {
        contextAPI.declareUserInput({ a: 1 });
        contextAPI.declareUserInput({ b: 2 });
        contextAPI.declareExternalData({ c: 3 }, 'api');

        const results = contextAPI.getByType(SDKContextType.USER_INPUT);
        expect(results).toHaveLength(2);
      });

      it('should get contexts by tag', () => {
        contextAPI.declare({
          type: SDKContextType.CUSTOM,
          data: { tagged: true },
          source: 'test',
          tags: ['myTag'],
        });

        const results = contextAPI.getByTag('myTag');
        expect(results).toHaveLength(1);
      });
    });

    describe('getLatest', () => {
      it('should get the most recent context of a type', async () => {
        contextAPI.declareUserInput({ first: true });
        await new Promise((resolve) => setTimeout(resolve, 5));
        contextAPI.declareUserInput({ second: true });

        const latest = contextAPI.getLatest(SDKContextType.USER_INPUT);
        expect(latest).toBeDefined();
        expect((latest?.data as { second: boolean }).second).toBe(true);
      });
    });

    describe('validate', () => {
      it('should pass valid context', () => {
        const result = contextAPI.validate({
          type: SDKContextType.USER_INPUT,
          data: { valid: true },
          source: 'test',
        });

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should fail for missing type', () => {
        const result = contextAPI.validate({
          type: '' as SDKContextType,
          data: {},
          source: 'test',
        } as DeclareContextInput);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Context type is required');
      });

      it('should fail for invalid confidence', () => {
        const result = contextAPI.validate({
          type: SDKContextType.USER_INPUT,
          data: {},
          source: 'test',
          confidence: 1.5,
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Confidence must be between 0 and 1');
      });

      it('should warn for low confidence', () => {
        const result = contextAPI.validate({
          type: SDKContextType.USER_INPUT,
          data: {},
          source: 'test',
          confidence: 0.3,
        });

        expect(result.valid).toBe(true);
        expect(result.warnings).toContain('Low confidence context may lead to unreliable decisions');
      });
    });

    describe('invalidate', () => {
      it('should invalidate a context', () => {
        const context = contextAPI.declareUserInput({ test: true });
        const result = contextAPI.invalidate(context.id);

        expect(result).toBe(true);
        expect(contextAPI.get(context.id)).toBeUndefined();
      });

      it('should return false for non-existent context', () => {
        const fakeId = computeContentAddress({ fake: true });
        const result = contextAPI.invalidate(fakeId);

        expect(result).toBe(false);
      });
    });

    describe('getStats', () => {
      it('should return context statistics', () => {
        contextAPI.declareUserInput({ a: 1 });
        contextAPI.declareExternalData({ b: 2 }, 'api');
        contextAPI.declareConfiguration({ c: 3 });

        const stats = contextAPI.getStats();

        expect(stats.total).toBe(3);
        expect(stats.active).toBe(3);
        expect(stats.expired).toBe(0);
        expect(stats.byType[SDKContextType.USER_INPUT]).toBe(1);
        expect(stats.avgConfidence).toBeGreaterThan(0);
      });
    });
  });

  describe('Decision API', () => {
    let decisionAPI: DecisionAPI;
    let contextAPI: ContextAPI;
    const actorId = computeContentAddress({ type: 'agent', name: 'test-agent' });

    beforeEach(() => {
      decisionAPI = createDecisionAPI(actorId);
      contextAPI = createContextAPI(actorId);
    });

    describe('action builder', () => {
      it('should build an action', () => {
        const action = decisionAPI
          .action()
          .withType('CREATE')
          .withParam('name', 'test-resource')
          .withParam('size', 100)
          .build();

        expect(action.type).toBe('CREATE');
        expect(action.parameters.name).toBe('test-resource');
        expect(action.parameters.size).toBe(100);
      });

      it('should include target when specified', () => {
        const targetId = computeContentAddress({ target: true });
        const action = decisionAPI.action().withType('UPDATE').withTarget(targetId).build();

        expect(action.targetId).toBe(targetId);
      });

      it('should throw when type is missing', () => {
        expect(() => decisionAPI.action().build()).toThrow('Action type is required');
      });
    });

    describe('propose', () => {
      it('should create a new proposal', () => {
        const context = contextAPI.declareUserInput({ query: 'test' });
        const action = decisionAPI.action().withType('QUERY').build();

        const proposal = decisionAPI.propose(action, [context], 'Testing proposal');

        expect(proposal.id).toBeDefined();
        expect(proposal.status).toBe(ProposalStatus.DRAFT);
        expect(proposal.action).toEqual(action);
        expect(proposal.rationale).toBe('Testing proposal');
        expect(proposal.contextRefs).toHaveLength(1);
      });

      it('should set context refs with decreasing relevance', () => {
        const ctx1 = contextAPI.declareUserInput({ first: true });
        const ctx2 = contextAPI.declareUserInput({ second: true });
        const ctx3 = contextAPI.declareUserInput({ third: true });

        const proposal = decisionAPI.propose(
          decisionAPI.action().withType('TEST').build(),
          [ctx1, ctx2, ctx3]
        );

        expect(proposal.contextRefs[0].relevance).toBe(1.0);
        expect(proposal.contextRefs[1].relevance).toBe(0.9);
        expect(proposal.contextRefs[2].relevance).toBe(0.8);
      });
    });

    describe('proposeAction', () => {
      it('should create proposal with action type and params', () => {
        const context = contextAPI.declareUserInput({ input: 'data' });

        const proposal = decisionAPI.proposeAction(
          'PROCESS',
          { format: 'json', validate: true },
          [context],
          'Process input data'
        );

        expect(proposal.action.type).toBe('PROCESS');
        expect(proposal.action.parameters.format).toBe('json');
        expect(proposal.action.parameters.validate).toBe(true);
      });
    });

    describe('submit', () => {
      it('should submit a draft proposal', async () => {
        const context = contextAPI.declareUserInput({ test: true });
        const proposal = decisionAPI.propose(
          decisionAPI.action().withType('TEST').build(),
          [context]
        );

        const result = await decisionAPI.submit(proposal.id);

        expect(result.approved).toBe(true);
        expect(result.verdictResult).toBe('ALLOW');
        expect(result.canExecute).toBe(true);
        expect(result.proposal.status).toBe(ProposalStatus.APPROVED);
      });

      it('should throw for non-existent proposal', async () => {
        await expect(decisionAPI.submit('fake-id')).rejects.toThrow('Proposal not found');
      });

      it('should throw for non-draft proposal', async () => {
        const context = contextAPI.declareUserInput({ test: true });
        const proposal = decisionAPI.propose(
          decisionAPI.action().withType('TEST').build(),
          [context]
        );

        await decisionAPI.submit(proposal.id);

        await expect(decisionAPI.submit(proposal.id)).rejects.toThrow('is not in draft status');
      });

      it('should handle DENY verdict', async () => {
        const mockEvaluator = {
          evaluate: async (): Promise<DecisionVerdict> => ({
            id: computeContentAddress({ verdict: true }),
            decisionId: computeContentAddress({ decision: true }),
            result: 'DENY',
            scope: 'test',
            policyResults: [],
            blockingPolicies: [computeContentAddress({ policy: 'deny' })],
            escalatingPolicies: [],
            annotations: [],
            violations: [
              {
                policyId: computeContentAddress({ policy: 'deny' }),
                message: 'Access denied',
                severity: 'critical' as const,
              },
            ],
            evaluatedAt: new Date().toISOString(),
            evaluationTimeMs: 1,
          }),
        };
        decisionAPI.setEvaluator(mockEvaluator);

        const context = contextAPI.declareUserInput({ test: true });
        const proposal = decisionAPI.propose(
          decisionAPI.action().withType('FORBIDDEN').build(),
          [context]
        );

        const result = await decisionAPI.submit(proposal.id);

        expect(result.approved).toBe(false);
        expect(result.verdictResult).toBe('DENY');
        expect(result.canExecute).toBe(false);
        expect(result.proposal.status).toBe(ProposalStatus.REJECTED);
        expect(result.feedback).toHaveLength(1);
        expect(result.feedback[0].type).toBe('violation');
      });

      it('should handle ESCALATE verdict', async () => {
        const mockEvaluator = {
          evaluate: async (): Promise<DecisionVerdict> => ({
            id: computeContentAddress({ verdict: true }),
            decisionId: computeContentAddress({ decision: true }),
            result: 'ESCALATE',
            scope: 'test',
            policyResults: [],
            blockingPolicies: [],
            escalatingPolicies: [computeContentAddress({ policy: 'escalate' })],
            annotations: [],
            violations: [],
            evaluatedAt: new Date().toISOString(),
            evaluationTimeMs: 1,
          }),
        };
        decisionAPI.setEvaluator(mockEvaluator);

        const context = contextAPI.declareUserInput({ test: true });
        const proposal = decisionAPI.propose(
          decisionAPI.action().withType('SENSITIVE').build(),
          [context]
        );

        const result = await decisionAPI.submit(proposal.id);

        expect(result.approved).toBe(false);
        expect(result.verdictResult).toBe('ESCALATE');
        expect(result.proposal.status).toBe(ProposalStatus.PENDING_APPROVAL);
      });
    });

    describe('execute', () => {
      it('should execute an approved proposal', async () => {
        const context = contextAPI.declareUserInput({ test: true });
        const proposal = decisionAPI.propose(
          decisionAPI.action().withType('TEST').build(),
          [context]
        );
        await decisionAPI.submit(proposal.id);

        const result = await decisionAPI.execute(proposal.id);

        expect(result.success).toBe(true);
        expect(result.proposal.status).toBe(ProposalStatus.EXECUTED);
      });

      it('should fail to execute non-approved proposal', async () => {
        const context = contextAPI.declareUserInput({ test: true });
        const proposal = decisionAPI.propose(
          decisionAPI.action().withType('TEST').build(),
          [context]
        );

        const result = await decisionAPI.execute(proposal.id);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Cannot execute proposal');
      });
    });

    describe('getProposal', () => {
      it('should retrieve a proposal by ID', () => {
        const context = contextAPI.declareUserInput({ test: true });
        const created = decisionAPI.propose(
          decisionAPI.action().withType('TEST').build(),
          [context]
        );

        const retrieved = decisionAPI.getProposal(created.id);

        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(created.id);
      });

      it('should return undefined for non-existent proposal', () => {
        const result = decisionAPI.getProposal('fake-id');
        expect(result).toBeUndefined();
      });
    });

    describe('getAllProposals and getProposalsByStatus', () => {
      it('should get all proposals', async () => {
        const context = contextAPI.declareUserInput({ test: true });
        decisionAPI.propose(decisionAPI.action().withType('ONE').build(), [context]);
        decisionAPI.propose(decisionAPI.action().withType('TWO').build(), [context]);
        decisionAPI.propose(decisionAPI.action().withType('THREE').build(), [context]);

        const all = decisionAPI.getAllProposals();
        expect(all).toHaveLength(3);
      });

      it('should get proposals by status', async () => {
        const context = contextAPI.declareUserInput({ test: true });
        const p1 = decisionAPI.propose(decisionAPI.action().withType('ONE').build(), [context]);
        decisionAPI.propose(decisionAPI.action().withType('TWO').build(), [context]);
        await decisionAPI.submit(p1.id);

        const drafts = decisionAPI.getProposalsByStatus(ProposalStatus.DRAFT);
        const approved = decisionAPI.getProposalsByStatus(ProposalStatus.APPROVED);

        expect(drafts).toHaveLength(1);
        expect(approved).toHaveLength(1);
      });
    });

    describe('withdraw', () => {
      it('should withdraw a proposal', () => {
        const context = contextAPI.declareUserInput({ test: true });
        const proposal = decisionAPI.propose(
          decisionAPI.action().withType('TEST').build(),
          [context]
        );

        const result = decisionAPI.withdraw(proposal.id);

        expect(result).toBe(true);
        expect(decisionAPI.getProposal(proposal.id)).toBeUndefined();
      });

      it('should not withdraw an executed proposal', async () => {
        const context = contextAPI.declareUserInput({ test: true });
        const proposal = decisionAPI.propose(
          decisionAPI.action().withType('TEST').build(),
          [context]
        );
        await decisionAPI.submit(proposal.id);
        await decisionAPI.execute(proposal.id);

        expect(() => decisionAPI.withdraw(proposal.id)).toThrow('Cannot withdraw an executed proposal');
      });
    });

    describe('getActorId', () => {
      it('should return the actor ID', () => {
        expect(decisionAPI.getActorId()).toBe(actorId);
      });
    });
  });

  describe('CommonActions', () => {
    it('should define standard action types', () => {
      expect(CommonActions.CREATE).toBe('CREATE');
      expect(CommonActions.UPDATE).toBe('UPDATE');
      expect(CommonActions.DELETE).toBe('DELETE');
      expect(CommonActions.READ).toBe('READ');
      expect(CommonActions.EXECUTE).toBe('EXECUTE');
      expect(CommonActions.APPROVE).toBe('APPROVE');
      expect(CommonActions.SEND).toBe('SEND');
      expect(CommonActions.TRANSFER).toBe('TRANSFER');
    });
  });
});
