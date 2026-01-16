/**
 * Event-Sourced Append-Only Storage for ContextGraph OS
 *
 * Implements T0.1.3: Define immutable append-only storage contract
 *
 * All state changes in ContextGraph are represented as immutable events.
 * The event store provides:
 * - Append-only writes (no updates or deletes)
 * - Ordered event streams
 * - Point-in-time reconstruction
 */

import type { ContentAddress } from '../identity/content-address.js';
import type { Timestamp } from '../time/temporal.js';
import { now } from '../time/temporal.js';
import { computeContentAddress } from '../identity/content-address.js';

/**
 * Event types in the system
 */
export const EventType = {
  /** A node was created */
  NODE_CREATED: 'NODE_CREATED',
  /** An edge was created */
  EDGE_CREATED: 'EDGE_CREATED',
  /** A node's status changed */
  NODE_STATUS_CHANGED: 'NODE_STATUS_CHANGED',
  /** A node's validity was updated */
  NODE_VALIDITY_CHANGED: 'NODE_VALIDITY_CHANGED',
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

/**
 * Base event structure
 * All events are immutable and content-addressed
 */
export interface StoredEvent<T = unknown> {
  /** Content-addressed unique identifier */
  readonly id: ContentAddress;
  /** Event type */
  readonly type: EventTypeValue;
  /** Event payload */
  readonly payload: T;
  /** When this event was recorded */
  readonly timestamp: Timestamp;
  /** Sequence number in the event stream */
  readonly sequence: number;
  /** Optional correlation ID for related events */
  readonly correlationId?: ContentAddress;
  /** Optional causation ID (the event that caused this one) */
  readonly causationId?: ContentAddress;
}

/**
 * Input for appending an event
 */
export interface AppendEventInput<T = unknown> {
  readonly type: EventTypeValue;
  readonly payload: T;
  readonly correlationId?: ContentAddress;
  readonly causationId?: ContentAddress;
}

/**
 * Query options for reading events
 */
export interface EventQueryOptions {
  /** Start from this sequence number (inclusive) */
  readonly fromSequence?: number;
  /** End at this sequence number (exclusive) */
  readonly toSequence?: number;
  /** Filter by event types */
  readonly types?: readonly EventTypeValue[];
  /** Filter by timestamp range */
  readonly fromTimestamp?: Timestamp;
  readonly toTimestamp?: Timestamp;
  /** Maximum number of events to return */
  readonly limit?: number;
  /** Filter by correlation ID */
  readonly correlationId?: ContentAddress;
}

/**
 * Result of a snapshot operation
 */
export interface Snapshot<T> {
  readonly state: T;
  readonly sequence: number;
  readonly timestamp: Timestamp;
}

/**
 * Event store interface
 * Defines the contract for append-only event storage
 */
export interface EventStore {
  /**
   * Append a new event to the store
   * Returns the stored event with assigned ID and sequence
   */
  append<T>(input: AppendEventInput<T>): Promise<StoredEvent<T>>;

  /**
   * Read events matching the query options
   */
  read(options?: EventQueryOptions): Promise<readonly StoredEvent[]>;

  /**
   * Get a single event by ID
   */
  getById(id: ContentAddress): Promise<StoredEvent | null>;

  /**
   * Get the current sequence number (latest event)
   */
  getSequence(): Promise<number>;

  /**
   * Subscribe to new events
   */
  subscribe(
    callback: (event: StoredEvent) => void | Promise<void>,
    options?: { types?: readonly EventTypeValue[] }
  ): () => void;
}

/**
 * In-memory implementation of EventStore
 * Suitable for testing and development
 */
export class InMemoryEventStore implements EventStore {
  private events: StoredEvent[] = [];
  private sequence = 0;
  private subscribers: Array<{
    callback: (event: StoredEvent) => void | Promise<void>;
    types?: readonly EventTypeValue[];
  }> = [];

  async append<T>(input: AppendEventInput<T>): Promise<StoredEvent<T>> {
    this.sequence += 1;
    const timestamp = now();

    // Create event without ID first to compute content address
    const eventData = {
      type: input.type,
      payload: input.payload,
      timestamp,
      sequence: this.sequence,
      correlationId: input.correlationId,
      causationId: input.causationId,
    };

    const id = computeContentAddress(eventData);

    // Build event object, only including optional fields if they exist
    const event: StoredEvent<T> = {
      id,
      type: input.type,
      payload: input.payload,
      timestamp,
      sequence: this.sequence,
      ...(input.correlationId !== undefined && { correlationId: input.correlationId }),
      ...(input.causationId !== undefined && { causationId: input.causationId }),
    };

    this.events.push(event as StoredEvent);

    // Notify subscribers
    await this.notifySubscribers(event as StoredEvent);

    return event;
  }

  async read(options: EventQueryOptions = {}): Promise<readonly StoredEvent[]> {
    let result = [...this.events];

    if (options.fromSequence !== undefined) {
      result = result.filter((e) => e.sequence >= options.fromSequence!);
    }

    if (options.toSequence !== undefined) {
      result = result.filter((e) => e.sequence < options.toSequence!);
    }

    if (options.types !== undefined && options.types.length > 0) {
      result = result.filter((e) => options.types!.includes(e.type));
    }

    if (options.fromTimestamp !== undefined) {
      result = result.filter((e) => e.timestamp >= options.fromTimestamp!);
    }

    if (options.toTimestamp !== undefined) {
      result = result.filter((e) => e.timestamp < options.toTimestamp!);
    }

    if (options.correlationId !== undefined) {
      result = result.filter((e) => e.correlationId === options.correlationId);
    }

    if (options.limit !== undefined) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  async getById(id: ContentAddress): Promise<StoredEvent | null> {
    return this.events.find((e) => e.id === id) ?? null;
  }

  async getSequence(): Promise<number> {
    return this.sequence;
  }

  subscribe(
    callback: (event: StoredEvent) => void | Promise<void>,
    options?: { types?: readonly EventTypeValue[] }
  ): () => void {
    const subscriber: {
      callback: (event: StoredEvent) => void | Promise<void>;
      types?: readonly EventTypeValue[];
    } = options?.types !== undefined ? { callback, types: options.types } : { callback };
    this.subscribers.push(subscriber);

    // Return unsubscribe function
    return (): void => {
      const index = this.subscribers.indexOf(subscriber);
      if (index > -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  private async notifySubscribers(event: StoredEvent): Promise<void> {
    for (const subscriber of this.subscribers) {
      if (
        subscriber.types === undefined ||
        subscriber.types.length === 0 ||
        subscriber.types.includes(event.type)
      ) {
        await subscriber.callback(event);
      }
    }
  }

  /**
   * Clear all events (for testing only)
   */
  clear(): void {
    this.events = [];
    this.sequence = 0;
  }

  /**
   * Get all events (for debugging/testing)
   */
  getAllEvents(): readonly StoredEvent[] {
    return [...this.events];
  }
}

/**
 * Create a new in-memory event store
 */
export function createInMemoryEventStore(): EventStore {
  return new InMemoryEventStore();
}
