/**
 * Actor Identity Model for ContextGraph OS
 *
 * Implements EPIC 5 Capability 5.1:
 * T5.1.1 Define Actor schema (human, agent, system)
 * T5.1.2 Bind actions to actor identity
 * T5.1.3 Enforce non-repudiation
 *
 * Humans are not exceptions. Neither are agents.
 * Every action has an owner.
 */

import type { ContentAddress } from '../core/identity/content-address.js';
import type { Timestamp } from '../core/time/temporal.js';
import { computeContentAddress } from '../core/identity/content-address.js';

/**
 * Actor types in the system
 */
export const ActorType = {
  /** A human user */
  HUMAN: 'HUMAN',
  /** An AI agent */
  AGENT: 'AGENT',
  /** An automated system process */
  SYSTEM: 'SYSTEM',
  /** A group of actors */
  GROUP: 'GROUP',
  /** A service account */
  SERVICE: 'SERVICE',
} as const;

export type ActorTypeValue = (typeof ActorType)[keyof typeof ActorType];

/**
 * Actor status
 */
export const ActorStatus = {
  /** Actor is active and can perform actions */
  ACTIVE: 'ACTIVE',
  /** Actor is temporarily suspended */
  SUSPENDED: 'SUSPENDED',
  /** Actor has been deactivated */
  DEACTIVATED: 'DEACTIVATED',
  /** Actor is pending activation */
  PENDING: 'PENDING',
} as const;

export type ActorStatusValue = (typeof ActorStatus)[keyof typeof ActorStatus];

/**
 * Actor identity definition
 */
export interface Actor {
  /** Unique actor ID (content-addressed) */
  readonly id: ContentAddress;
  /** Actor type */
  readonly type: ActorTypeValue;
  /** Display name */
  readonly name: string;
  /** External identifier (email, agent ID, etc.) */
  readonly externalId?: string;
  /** Current status */
  readonly status: ActorStatusValue;
  /** Authority scopes granted to this actor */
  readonly authorities: readonly string[];
  /** Parent actor (for delegation/hierarchy) */
  readonly parentId?: ContentAddress;
  /** Group memberships */
  readonly groupIds?: readonly ContentAddress[];
  /** When the actor was created */
  readonly createdAt: Timestamp;
  /** When the actor was last active */
  readonly lastActiveAt?: Timestamp;
  /** Additional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Actor credentials for authentication
 */
export interface ActorCredentials {
  /** The actor this credential belongs to */
  readonly actorId: ContentAddress;
  /** Credential type */
  readonly type: 'api_key' | 'certificate' | 'token' | 'password_hash';
  /** Credential identifier (not the secret) */
  readonly credentialId: string;
  /** When the credential was issued */
  readonly issuedAt: Timestamp;
  /** When the credential expires */
  readonly expiresAt?: Timestamp;
  /** Scopes this credential grants */
  readonly scopes: readonly string[];
}

/**
 * Action attribution record
 */
export interface ActionAttribution {
  /** The action being attributed */
  readonly actionId: ContentAddress;
  /** The actor who performed the action */
  readonly actorId: ContentAddress;
  /** When the action was performed */
  readonly performedAt: Timestamp;
  /** Acting on behalf of (if delegated) */
  readonly onBehalfOf?: ContentAddress;
  /** Credential used for authentication */
  readonly credentialId?: string;
  /** IP address or origin (if applicable) */
  readonly origin?: string;
  /** Signature for non-repudiation (if available) */
  readonly signature?: string;
}

/**
 * Input for registering a new actor
 */
export interface RegisterActorInput {
  /** Actor type */
  readonly type: ActorTypeValue;
  /** Display name */
  readonly name: string;
  /** External identifier */
  readonly externalId?: string;
  /** Initial authorities */
  readonly authorities?: readonly string[];
  /** Parent actor ID */
  readonly parentId?: ContentAddress;
  /** Group memberships */
  readonly groupIds?: readonly ContentAddress[];
  /** Additional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Actor Registry
 *
 * Manages actor identities and ensures non-repudiation.
 */
export class ActorRegistry {
  private actors: Map<ContentAddress, Actor> = new Map();
  private byExternalId: Map<string, ContentAddress> = new Map();
  private attributions: ActionAttribution[] = [];

  /**
   * Register a new actor
   */
  async register(input: RegisterActorInput): Promise<Actor> {
    const createdAt = new Date().toISOString();

    const actorData = {
      type: input.type,
      name: input.name,
      externalId: input.externalId,
      createdAt,
    };

    const id = computeContentAddress(actorData);

    // Check for duplicate external ID
    if (input.externalId && this.byExternalId.has(input.externalId)) {
      throw new Error(`Actor with external ID '${input.externalId}' already exists`);
    }

    const actor: Actor = {
      id,
      type: input.type,
      name: input.name,
      status: 'ACTIVE',
      authorities: input.authorities ?? [],
      createdAt,
      ...(input.externalId !== undefined && { externalId: input.externalId }),
      ...(input.parentId !== undefined && { parentId: input.parentId }),
      ...(input.groupIds !== undefined && { groupIds: input.groupIds }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    };

    this.actors.set(id, actor);
    if (input.externalId) {
      this.byExternalId.set(input.externalId, id);
    }

    return actor;
  }

  /**
   * Get an actor by ID
   */
  getActor(id: ContentAddress): Actor | undefined {
    return this.actors.get(id);
  }

  /**
   * Get an actor by external ID
   */
  getActorByExternalId(externalId: string): Actor | undefined {
    const id = this.byExternalId.get(externalId);
    return id ? this.actors.get(id) : undefined;
  }

  /**
   * Update actor status
   */
  async updateStatus(actorId: ContentAddress, status: ActorStatusValue): Promise<Actor> {
    const actor = this.actors.get(actorId);
    if (!actor) {
      throw new Error(`Actor not found: ${actorId}`);
    }

    const updatedActor: Actor = {
      ...actor,
      status,
    };

    this.actors.set(actorId, updatedActor);
    return updatedActor;
  }

  /**
   * Update actor authorities
   */
  async updateAuthorities(
    actorId: ContentAddress,
    authorities: readonly string[]
  ): Promise<Actor> {
    const actor = this.actors.get(actorId);
    if (!actor) {
      throw new Error(`Actor not found: ${actorId}`);
    }

    const updatedActor: Actor = {
      ...actor,
      authorities,
    };

    this.actors.set(actorId, updatedActor);
    return updatedActor;
  }

  /**
   * Record action attribution (for non-repudiation)
   */
  async attributeAction(
    actionId: ContentAddress,
    actorId: ContentAddress,
    options?: {
      onBehalfOf?: ContentAddress;
      credentialId?: string;
      origin?: string;
      signature?: string;
    }
  ): Promise<ActionAttribution> {
    const actor = this.actors.get(actorId);
    if (!actor) {
      throw new Error(`Actor not found: ${actorId}`);
    }

    if (actor.status !== 'ACTIVE') {
      throw new Error(`Actor ${actorId} is not active (status: ${actor.status})`);
    }

    const attribution: ActionAttribution = {
      actionId,
      actorId,
      performedAt: new Date().toISOString(),
      ...(options?.onBehalfOf !== undefined && { onBehalfOf: options.onBehalfOf }),
      ...(options?.credentialId !== undefined && { credentialId: options.credentialId }),
      ...(options?.origin !== undefined && { origin: options.origin }),
      ...(options?.signature !== undefined && { signature: options.signature }),
    };

    this.attributions.push(attribution);

    // Update last active timestamp
    const updatedActor: Actor = {
      ...actor,
      lastActiveAt: attribution.performedAt,
    };
    this.actors.set(actorId, updatedActor);

    return attribution;
  }

  /**
   * Get all attributions for an action
   */
  getAttributions(actionId: ContentAddress): readonly ActionAttribution[] {
    return this.attributions.filter((a) => a.actionId === actionId);
  }

  /**
   * Get all actions by an actor
   */
  getActorActions(actorId: ContentAddress): readonly ActionAttribution[] {
    return this.attributions.filter((a) => a.actorId === actorId);
  }

  /**
   * Verify action attribution (non-repudiation check)
   */
  async verifyAttribution(actionId: ContentAddress): Promise<{
    verified: boolean;
    attribution?: ActionAttribution;
    actor?: Actor;
    reason?: string;
  }> {
    const attributions = this.getAttributions(actionId);

    if (attributions.length === 0) {
      return { verified: false, reason: 'No attribution found for action' };
    }

    const attribution = attributions[0];
    if (!attribution) {
      return { verified: false, reason: 'Attribution is undefined' };
    }

    const actor = this.actors.get(attribution.actorId);

    if (!actor) {
      return {
        verified: false,
        attribution,
        reason: 'Actor no longer exists',
      };
    }

    return {
      verified: true,
      attribution,
      actor,
    };
  }

  /**
   * Get all actors of a specific type
   */
  getActorsByType(type: ActorTypeValue): readonly Actor[] {
    return Array.from(this.actors.values()).filter((a) => a.type === type);
  }

  /**
   * Get all active actors
   */
  getActiveActors(): readonly Actor[] {
    return Array.from(this.actors.values()).filter((a) => a.status === 'ACTIVE');
  }
}

/**
 * Create an actor registry
 */
export function createActorRegistry(): ActorRegistry {
  return new ActorRegistry();
}

/**
 * Check if an actor is a human
 */
export function isHuman(actor: Actor): boolean {
  return actor.type === 'HUMAN';
}

/**
 * Check if an actor is an agent
 */
export function isAgent(actor: Actor): boolean {
  return actor.type === 'AGENT';
}

/**
 * Check if an actor is a system
 */
export function isSystem(actor: Actor): boolean {
  return actor.type === 'SYSTEM';
}
