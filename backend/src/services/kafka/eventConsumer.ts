import { createHash } from 'node:crypto';
import {
  kafkaCommitsTotal,
  kafkaConsumerErrorsTotal,
  kafkaConsumerRebalancesTotal,
  kafkaEventsProcessedTotal,
  recordFetchLatency,
  updatePartitionLag,
} from '../../metrics/kafkaConsumerMetrics.js';
import { decodeScVal } from '../contractEventParser.js';

export interface KafkaMessageLike {
  key?: Buffer | string | null;
  value?: Buffer | string | null;
  headers?: Record<
    string,
    Buffer | string | Array<Buffer | string> | undefined
  >;
  offset: string;
  timestamp?: string;
  topic?: string;
  partition?: number;
}

export interface KafkaPartitionOffsetLike {
  topic: string;
  partitions: Array<{ partition: number; offset: string }>;
}

export interface KafkaBatchLike {
  topic: string;
  partition: number;
  messages: KafkaMessageLike[];
  highWatermark?: string;
  heartbeat?: () => Promise<void>;
  isRunning?: () => boolean;
}

export interface KafkaConsumerLike {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  subscribe: (options: {
    topics: string[];
    fromBeginning?: boolean;
  }) => Promise<void>;
  run: (options: {
    autoCommit?: boolean;
    eachBatchAutoResolve?: boolean;
    partitionsConsumedConcurrently?: number;
    eachBatch: (payload: KafkaBatchLike) => Promise<void>;
  }) => Promise<void>;
  commitOffsets: (
    offsets: Array<{ topic: string; partition: number; offset: string }>
  ) => Promise<void>;
  fetchOffsets?: (options: {
    groupId: string;
    topics: string[];
  }) => Promise<KafkaPartitionOffsetLike[]>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  events?: Record<string, string>;
}

export interface KafkaAdminLike {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  fetchTopicOffsets: (
    topic: string
  ) => Promise<
    Array<{ partition: number; offset: string; high?: string; low?: string }>
  >;
}

export interface KafkaLike {
  consumer: (config: Record<string, unknown>) => KafkaConsumerLike;
  admin: () => KafkaAdminLike;
}

export interface EventDatabaseLike {
  run: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ changes?: number; id?: number } | undefined>;
  transaction?: <T>(
    callback: (db: EventDatabaseLike) => Promise<T>
  ) => Promise<T>;
}

export interface KafkaEventLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface KafkaRetryConfig {
  retries?: number;
  initialRetryTime?: number;
  maxRetryTime?: number;
  factor?: number;
}

export interface KafkaEventConsumerConfig {
  brokers: string[];
  clientId?: string;
  groupId: string;
  topics: string[];
  fromBeginning?: boolean;
  ssl?: boolean;
  sasl?: Record<string, unknown>;
  sessionTimeout?: number;
  heartbeatInterval?: number;
  maxBytesPerPartition?: number;
  minBytes?: number;
  maxBytes?: number;
  maxWaitTimeInMs?: number;
  partitionsConsumedConcurrently?: number;
  retry?: KafkaRetryConfig;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  lagCheckIntervalMs?: number;
  database?: EventDatabaseLike;
  kafka?: KafkaLike;
  consumerFactory?: (kafka: KafkaLike) => KafkaConsumerLike;
  logger?: KafkaEventLogger;
  onEvent?: (event: IndexedLedgerEvent) => void | Promise<void>;
}

export interface KafkaEventMetadata {
  topic: string;
  partition: number;
  offset: string;
  timestamp?: string;
  key?: string | null;
}

export interface IndexedLedgerEvent {
  contractId: string;
  ledgerSequence: number;
  topics: unknown[];
  value: unknown;
  rawXdr: string | null;
  eventType: string;
  eventKey: string;
  kafka: KafkaEventMetadata;
}

export interface BatchProcessResult {
  processed: number;
  inserted: number;
  duplicates: number;
  committedOffset: string | null;
}

export interface KafkaConsumerStatus {
  running: boolean;
  groupId: string;
  topics: string[];
  processed: number;
  inserted: number;
  duplicates: number;
  rebalances: number;
  lastError: string | null;
  lastBatchAt: string | null;
  lastCommitAt: string | null;
}

const INSERT_EVENT_SQL = `
  INSERT INTO contract_events
    (contract_id, ledger_sequence, topics, value, raw_xdr, event_type,
     event_key, kafka_topic, kafka_partition, kafka_offset, indexed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(event_key) DO NOTHING
`;

const KAFKA_EVENT_NAMES = {
  GROUP_JOIN: 'consumer.group_join',
  REBALANCING: 'consumer.rebalancing',
  DISCONNECT: 'consumer.disconnect',
  CRASH: 'consumer.crash',
};

function toInteger(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function headerValue(
  message: KafkaMessageLike,
  names: string[]
): string | undefined {
  if (!message.headers) return undefined;

  for (const name of names) {
    const raw = message.headers[name] ?? message.headers[name.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (Buffer.isBuffer(value)) return value.toString('utf8');
    if (typeof value === 'string' && value.length > 0) return value;
  }

  return undefined;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, nested) =>
      typeof nested === 'bigint' ? nested.toString() : nested
    );
  } catch {
    return JSON.stringify(String(value));
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function decodeMessagePayload(
  message: KafkaMessageLike
): Record<string, unknown> {
  const raw = message.value;
  if (raw === null || raw === undefined) return {};

  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  const trimmed = text.trim();
  if (trimmed === '') return {};

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { xdr: trimmed };
  }
}

function decodeMaybeScVal(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return decodeScVal(value);
    } catch {
      return value;
    }
  }

  if (Buffer.isBuffer(value)) {
    try {
      return decodeScVal(value.toString('base64'));
    } catch {
      return value.toString('utf8');
    }
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.xdr === 'string') {
      try {
        return decodeScVal(record.xdr);
      } catch {
        return record.xdr;
      }
    }
  }

  return value;
}

function normalizeTopics(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return value.map((topic) => decodeMaybeScVal(topic));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((topic) => decodeMaybeScVal(topic));
        }
      } catch {
        // Fall through and treat the string as a single topic.
      }
    }
    return [decodeMaybeScVal(trimmed)];
  }

  return [decodeMaybeScVal(value)];
}

function extractContractId(
  payload: Record<string, unknown>,
  message: KafkaMessageLike
): string | undefined {
  const candidates = [
    payload.contractId,
    payload.contract_id,
    payload.contract,
    headerValue(message, ['contract-id', 'contractId', 'contract_id']),
    message.key,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;

    if (Buffer.isBuffer(candidate)) {
      const text = candidate.toString('utf8').trim();
      if (text.startsWith('C')) return text;
      const decoded = decodeMaybeScVal(candidate);
      if (typeof decoded === 'string' && decoded.length > 0) return decoded;
      continue;
    }

    if (typeof candidate === 'string') {
      const text = candidate.trim();
      if (text.length === 0) continue;
      if (text.startsWith('C')) return text;
      const decoded = decodeMaybeScVal(text);
      if (typeof decoded === 'string' && decoded.length > 0) return decoded;
      continue;
    }

    if (typeof candidate === 'object') {
      const decoded = decodeMaybeScVal(candidate);
      if (typeof decoded === 'string' && decoded.length > 0) return decoded;
    }
  }

  return undefined;
}

function extractEventKey(
  payload: Record<string, unknown>,
  message: KafkaMessageLike,
  contractId: string,
  ledgerSequence: number
): string {
  const explicitId =
    payload.eventId ??
    payload.event_id ??
    payload.id ??
    headerValue(message, ['event-id', 'event_id', 'eventId']);

  const source =
    explicitId !== null && explicitId !== undefined && String(explicitId) !== ''
      ? `${contractId}:${ledgerSequence}:${String(explicitId)}`
      : `${message.topic ?? 'unknown'}:${message.partition ?? 0}:${message.offset}`;

  return sha256Hex(source);
}

/**
 * Extract the Kafka partition key for a Soroban event. Producers must use this
 * value as the message key so every event for a contract lands on the same
 * partition and is therefore processed in order.
 */
export function partitionKeyForEvent(
  event: Record<string, unknown> | null | undefined
): string | undefined {
  if (!event) return undefined;
  const candidate =
    event.contractId ?? event.contract_id ?? event.contract ?? event.key;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return undefined;
}

/**
 * Decodes a Kafka message into the indexed event shape. Handles JSON payloads,
 * base64-encoded XDR topics/values, and contract IDs supplied in the message key.
 */
export function decodeKafkaMessage(
  message: KafkaMessageLike,
  topic = message.topic ?? 'unknown'
): IndexedLedgerEvent {
  const payload = decodeMessagePayload(message);
  const contractId = extractContractId(payload, message);
  if (!contractId) {
    throw new Error(
      `Kafka message ${topic}/${message.partition ?? 0}/${message.offset} has no contract ID`
    );
  }

  const ledgerCloseMeta =
    payload.ledgerCloseMeta && typeof payload.ledgerCloseMeta === 'object'
      ? (payload.ledgerCloseMeta as Record<string, unknown>)
      : undefined;
  const ledgerSequence = toInteger(
    payload.ledger ??
      payload.ledgerSequence ??
      payload.ledger_sequence ??
      ledgerCloseMeta?.ledgerSequence ??
      ledgerCloseMeta?.ledger
  );
  if (ledgerSequence <= 0) {
    throw new Error(
      `Kafka message ${topic}/${message.partition ?? 0}/${message.offset} has no ledger sequence`
    );
  }

  const rawValue =
    payload.value ??
    payload.event ??
    payload.data ??
    (payload.xdr !== undefined ? payload : null);
  const value =
    rawValue && typeof rawValue === 'object' && 'xdr' in rawValue
      ? decodeMaybeScVal(rawValue)
      : decodeMaybeScVal(rawValue);

  const rawXdr =
    rawValue &&
    typeof rawValue === 'object' &&
    typeof (rawValue as Record<string, unknown>).xdr === 'string'
      ? String((rawValue as Record<string, unknown>).xdr)
      : typeof payload.raw_xdr === 'string'
        ? payload.raw_xdr
        : typeof payload.rawXdr === 'string'
          ? payload.rawXdr
          : typeof payload.xdr === 'string'
            ? payload.xdr
            : null;

  const eventType = String(
    payload.type ?? payload.eventType ?? payload.event_type ?? 'contract'
  );

  return {
    contractId,
    ledgerSequence,
    topics: normalizeTopics(payload.topic ?? payload.topics),
    value,
    rawXdr,
    eventType,
    eventKey: extractEventKey(
      payload,
      { ...message, topic },
      contractId,
      ledgerSequence
    ),
    kafka: {
      topic,
      partition: message.partition ?? 0,
      offset: message.offset,
      timestamp: message.timestamp,
      key:
        message.key === null || message.key === undefined
          ? null
          : Buffer.isBuffer(message.key)
            ? message.key.toString('utf8')
            : String(message.key),
    },
  };
}

export function computeBackoffDelay(
  attempt: number,
  baseDelayMs = 500,
  maxDelayMs = 30_000,
  random: () => number = Math.random
): number {
  const exponential = Math.min(
    maxDelayMs,
    baseDelayMs * 2 ** Math.max(0, attempt)
  );
  const jitter = 0.5 + random() * 0.5;
  return Math.min(maxDelayMs, Math.round(exponential * jitter));
}

export function kafkaConsumerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): KafkaEventConsumerConfig {
  const brokers = String(env.KAFKA_BROKERS ?? '127.0.0.1:9092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
  const topics = String(env.KAFKA_TOPICS ?? 'soroban-ledger-events')
    .split(',')
    .map((topic) => topic.trim())
    .filter(Boolean);

  return {
    brokers,
    clientId: env.KAFKA_CLIENT_ID ?? 'soroban-playground-ledger-ingest',
    groupId: env.KAFKA_GROUP_ID ?? 'soroban-playground-ledger-indexer',
    topics,
    fromBeginning: env.KAFKA_FROM_BEGINNING === 'true',
    sessionTimeout: toInteger(env.KAFKA_SESSION_TIMEOUT_MS, 30_000),
    heartbeatInterval: toInteger(env.KAFKA_HEARTBEAT_INTERVAL_MS, 3_000),
    maxBytesPerPartition: toInteger(
      env.KAFKA_MAX_BYTES_PER_PARTITION,
      1_048_576
    ),
    maxWaitTimeInMs: toInteger(env.KAFKA_MAX_WAIT_MS, 100),
    partitionsConsumedConcurrently: toInteger(
      env.KAFKA_PARTITIONS_CONCURRENTLY,
      3
    ),
    reconnectBaseDelayMs: toInteger(env.KAFKA_RECONNECT_BASE_MS, 500),
    reconnectMaxDelayMs: toInteger(env.KAFKA_RECONNECT_MAX_MS, 30_000),
    lagCheckIntervalMs: toInteger(env.KAFKA_LAG_CHECK_INTERVAL_MS, 15_000),
  };
}

export class KafkaEventConsumer {
  private readonly config: KafkaEventConsumerConfig;
  private readonly logger: KafkaEventLogger;
  private kafka: KafkaLike | null = null;
  private consumer: KafkaConsumerLike | null = null;
  private admin: KafkaAdminLike | null = null;
  private database: EventDatabaseLike | null = null;
  private loopPromise: Promise<void> | null = null;
  private lagTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private stopped = false;

  private status: KafkaConsumerStatus;

  constructor(config: KafkaEventConsumerConfig) {
    if (!config.groupId) throw new Error('Kafka consumer groupId is required');
    if (!Array.isArray(config.topics) || config.topics.length === 0) {
      throw new Error('At least one Kafka topic is required');
    }
    if (!Array.isArray(config.brokers) || config.brokers.length === 0) {
      throw new Error('At least one Kafka broker is required');
    }

    this.config = config;
    this.logger = config.logger ?? console;
    this.database = config.database ?? null;
    this.status = {
      running: false,
      groupId: config.groupId,
      topics: [...config.topics],
      processed: 0,
      inserted: 0,
      duplicates: 0,
      rebalances: 0,
      lastError: null,
      lastBatchAt: null,
      lastCommitAt: null,
    };
  }

  getStatus(): KafkaConsumerStatus {
    return { ...this.status, topics: [...this.status.topics] };
  }

  isRunning(): boolean {
    return this.status.running;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.status.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.status.running = false;
    this.stopLagMonitor();
    await this.safeDisconnect();
    if (this.loopPromise) {
      await this.loopPromise.catch(() => {});
      this.loopPromise = null;
    }
    this.started = false;
  }

  private async runLoop(): Promise<void> {
    let attempt = 0;
    const baseDelay = this.config.reconnectBaseDelayMs ?? 500;
    const maxDelay = this.config.reconnectMaxDelayMs ?? 30_000;

    while (!this.stopped) {
      try {
        await this.connect();
        attempt = 0;
        this.startLagMonitor();

        await this.consumer?.run({
          autoCommit: false,
          eachBatchAutoResolve: false,
          partitionsConsumedConcurrently:
            this.config.partitionsConsumedConcurrently ?? 3,
          eachBatch: (batch) =>
            this.processBatch(batch, this.consumer ?? undefined),
        });

        if (this.stopped) break;
        throw new Error('Kafka consumer run loop ended unexpectedly');
      } catch (error) {
        this.status.lastError =
          error instanceof Error ? error.message : String(error);
        kafkaConsumerErrorsTotal.inc({ stage: 'consumer_loop' });
        this.logger.error('[KafkaEventConsumer] consumer loop error', error);
      } finally {
        this.stopLagMonitor();
        await this.safeDisconnect();
      }

      if (this.stopped) break;
      const delay = computeBackoffDelay(attempt, baseDelay, maxDelay);
      attempt += 1;
      this.logger.warn(
        `[KafkaEventConsumer] reconnecting in ${delay}ms (attempt ${attempt})`
      );
      await this.sleep(delay);
    }
  }

  private async connect(): Promise<void> {
    const kafka = this.config.kafka ?? (await this.createKafkaClient());
    this.kafka = kafka;
    const consumer =
      this.config.consumerFactory?.(kafka) ??
      kafka.consumer({
        groupId: this.config.groupId,
        sessionTimeout: this.config.sessionTimeout ?? 30_000,
        heartbeatInterval: this.config.heartbeatInterval ?? 3_000,
        maxBytesPerPartition: this.config.maxBytesPerPartition ?? 1_048_576,
        minBytes: this.config.minBytes ?? 1,
        maxBytes: this.config.maxBytes ?? 10_485_760,
        maxWaitTimeInMs: this.config.maxWaitTimeInMs ?? 100,
        retry: {
          retries: this.config.retry?.retries ?? 10,
          initialRetryTime: this.config.retry?.initialRetryTime ?? 300,
          maxRetryTime: this.config.retry?.maxRetryTime ?? 30_000,
          factor: this.config.retry?.factor ?? 2,
        },
        allowAutoTopicCreation: false,
        readUncommitted: false,
      });

    this.consumer = consumer;
    this.registerConsumerListeners(consumer);
    await consumer.connect();
    await consumer.subscribe({
      topics: this.config.topics,
      fromBeginning: this.config.fromBeginning ?? false,
    });

    try {
      const admin = kafka.admin();
      await admin.connect();
      this.admin = admin;
    } catch (error) {
      this.logger.warn('[KafkaEventConsumer] admin client unavailable', error);
      this.admin = null;
    }
  }

  private async createKafkaClient(): Promise<KafkaLike> {
    const kafkaModule = await import('kafkajs');
    const KafkaConstructor =
      (
        kafkaModule as {
          Kafka?: new (config: Record<string, unknown>) => KafkaLike;
        }
      ).Kafka ??
      (
        kafkaModule as {
          default?: {
            Kafka?: new (config: Record<string, unknown>) => KafkaLike;
          };
        }
      ).default?.Kafka;

    if (!KafkaConstructor) {
      throw new Error('kafkajs did not export a Kafka client');
    }

    return new KafkaConstructor({
      clientId: this.config.clientId ?? 'soroban-playground-ledger-ingest',
      brokers: this.config.brokers,
      ssl: this.config.ssl,
      sasl: this.config.sasl,
      retry: {
        retries: this.config.retry?.retries ?? 10,
        initialRetryTime: this.config.retry?.initialRetryTime ?? 300,
        maxRetryTime: this.config.retry?.maxRetryTime ?? 30_000,
        factor: this.config.retry?.factor ?? 2,
      },
    });
  }

  private registerConsumerListeners(consumer: KafkaConsumerLike): void {
    const events = consumer.events ?? KAFKA_EVENT_NAMES;

    consumer.on?.(events.GROUP_JOIN, () => {
      this.status.rebalances += 1;
      kafkaConsumerRebalancesTotal.inc({ event: 'group_join' });
      this.logger.info('[KafkaEventConsumer] consumer group joined');
    });
    consumer.on?.(events.REBALANCING, () => {
      this.status.rebalances += 1;
      kafkaConsumerRebalancesTotal.inc({ event: 'rebalancing' });
      this.logger.warn('[KafkaEventConsumer] consumer group rebalancing');
    });
    consumer.on?.(events.DISCONNECT, () => {
      kafkaConsumerRebalancesTotal.inc({ event: 'disconnect' });
      this.logger.warn('[KafkaEventConsumer] consumer disconnected');
    });
    consumer.on?.(events.CRASH, (event) => {
      kafkaConsumerErrorsTotal.inc({ stage: 'crash' });
      this.logger.error('[KafkaEventConsumer] consumer crashed', event);
    });
  }

  async processBatch(
    batch: KafkaBatchLike,
    consumer: KafkaConsumerLike | undefined = this.consumer ?? undefined
  ): Promise<BatchProcessResult> {
    const topic = batch.topic;
    const partition = batch.partition ?? 0;
    const messages = batch.messages ?? [];
    const startedAt = Date.now();
    const events: IndexedLedgerEvent[] = [];
    let lastOffset: string | null = null;

    for (let index = 0; index < messages.length; index += 1) {
      if (this.stopped) break;
      const message = messages[index];
      events.push(decodeKafkaMessage(message, topic));
      lastOffset = message.offset;

      if (index > 0 && index % 500 === 0) {
        await batch.heartbeat?.();
      }
    }

    const persisted = await this.persistBatch(events);

    for (const result of persisted) {
      kafkaEventsProcessedTotal.inc(
        {
          topic,
          partition: String(partition),
          status: result.inserted ? 'inserted' : 'duplicate',
        },
        1
      );

      if (result.inserted && this.config.onEvent) {
        await this.config.onEvent(result.event);
      }
    }

    this.status.processed += persisted.length;
    this.status.inserted += persisted.filter((item) => item.inserted).length;
    this.status.duplicates += persisted.filter((item) => !item.inserted).length;
    this.status.lastBatchAt = new Date().toISOString();

    let committedOffset: string | null = null;
    if (lastOffset !== null && consumer) {
      const nextOffset = String(BigInt(lastOffset) + 1n);
      await consumer.commitOffsets([{ topic, partition, offset: nextOffset }]);
      committedOffset = nextOffset;
      this.status.lastCommitAt = new Date().toISOString();
      kafkaCommitsTotal.inc({
        topic,
        partition: String(partition),
        status: 'success',
      });
    }

    recordFetchLatency(topic, Date.now() - startedAt);

    return {
      processed: persisted.length,
      inserted: persisted.filter((item) => item.inserted).length,
      duplicates: persisted.filter((item) => !item.inserted).length,
      committedOffset,
    };
  }

  private async persistBatch(
    events: IndexedLedgerEvent[]
  ): Promise<Array<{ event: IndexedLedgerEvent; inserted: boolean }>> {
    if (events.length === 0) return [];

    const db = await this.getDatabase();
    const results: Array<{ event: IndexedLedgerEvent; inserted: boolean }> = [];

    const execute = async (handle: EventDatabaseLike) => {
      for (const event of events) {
        const result = await handle.run(INSERT_EVENT_SQL, [
          event.contractId,
          event.ledgerSequence,
          stringifyJson(event.topics),
          stringifyJson(event.value),
          event.rawXdr,
          event.eventType,
          event.eventKey,
          event.kafka.topic,
          event.kafka.partition,
          event.kafka.offset,
        ]);
        results.push({
          event,
          inserted: result?.changes !== 0,
        });
      }
    };

    if (typeof db.transaction === 'function') {
      await db.transaction(execute);
    } else {
      await db.run('BEGIN');
      try {
        await execute(db);
        await db.run('COMMIT');
      } catch (error) {
        await db.run('ROLLBACK');
        throw error;
      }
    }

    return results;
  }

  private async getDatabase(): Promise<EventDatabaseLike> {
    if (this.database) return this.database;

    const { getDatabase, initializeDatabase } =
      await import('../../database/connection.js');
    try {
      this.database = getDatabase() as EventDatabaseLike;
    } catch {
      this.database = (await initializeDatabase()) as EventDatabaseLike;
    }
    return this.database;
  }

  private startLagMonitor(): void {
    this.stopLagMonitor();
    if (!this.admin || !this.consumer?.fetchOffsets) return;

    const interval = this.config.lagCheckIntervalMs ?? 15_000;
    this.lagTimer = setInterval(() => {
      this.refreshLag().catch((error) => {
        kafkaConsumerErrorsTotal.inc({ stage: 'lag_monitor' });
        this.logger.warn('[KafkaEventConsumer] lag refresh failed', error);
      });
    }, interval);

    if (typeof this.lagTimer.unref === 'function') this.lagTimer.unref();
    void this.refreshLag().catch(() => {});
  }

  private stopLagMonitor(): void {
    if (this.lagTimer) {
      clearInterval(this.lagTimer);
      this.lagTimer = null;
    }
  }

  async refreshLag(): Promise<void> {
    if (!this.admin || !this.consumer?.fetchOffsets) return;

    const committed = await this.consumer.fetchOffsets({
      groupId: this.config.groupId,
      topics: this.config.topics,
    });
    const committedByTopic = new Map<string, Map<number, number>>();

    for (const topicOffset of committed) {
      const partitions = new Map<number, number>();
      for (const partition of topicOffset.partitions ?? []) {
        partitions.set(partition.partition, toInteger(partition.offset, -1));
      }
      committedByTopic.set(topicOffset.topic, partitions);
    }

    for (const topic of this.config.topics) {
      const highWatermarks = await this.admin.fetchTopicOffsets(topic);
      const topicCommitted = committedByTopic.get(topic) ?? new Map();

      for (const highWatermark of highWatermarks) {
        const high = toInteger(highWatermark.high ?? highWatermark.offset, 0);
        const low = toInteger(highWatermark.low, 0);
        const committedOffset = topicCommitted.get(highWatermark.partition);
        const current =
          committedOffset === undefined || committedOffset < 0
            ? low
            : committedOffset;
        updatePartitionLag(
          topic,
          highWatermark.partition,
          Math.max(0, high - current)
        );
      }
    }
  }

  private async safeDisconnect(): Promise<void> {
    const consumer = this.consumer;
    const admin = this.admin;
    this.consumer = null;
    this.admin = null;

    if (consumer) {
      try {
        await consumer.disconnect();
      } catch (error) {
        this.logger.warn(
          '[KafkaEventConsumer] consumer disconnect failed',
          error
        );
      }
    }
    if (admin) {
      try {
        await admin.disconnect();
      } catch (error) {
        this.logger.warn('[KafkaEventConsumer] admin disconnect failed', error);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (typeof timer.unref === 'function') timer.unref();
    });
  }
}

export const kafkaEventConsumer = new KafkaEventConsumer(
  kafkaConsumerConfigFromEnv()
);

export default kafkaEventConsumer;
