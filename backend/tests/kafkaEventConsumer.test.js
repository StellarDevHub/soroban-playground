import initSqlJs from 'sql.js';
import { nativeToScVal } from '@stellar/stellar-sdk';

import {
  KafkaEventConsumer,
  computeBackoffDelay,
  decodeKafkaMessage,
  partitionKeyForEvent,
} from '../src/services/kafka/eventConsumer.ts';
import { kafkaRecordsLagMax } from '../src/metrics/kafkaConsumerMetrics.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

function jsonMessage(overrides = {}) {
  return {
    offset: '10',
    timestamp: '1750000000000',
    key: Buffer.from(CONTRACT_ID),
    topic: 'soroban-ledger-events',
    partition: 2,
    value: Buffer.from(
      JSON.stringify({
        contractId: CONTRACT_ID,
        ledger: 42,
        topic: ['transfer'],
        value: { amount: 10 },
        type: 'contract',
      })
    ),
    ...overrides,
  };
}

function batch(messages, overrides = {}) {
  return {
    topic: 'soroban-ledger-events',
    partition: 2,
    messages,
    highWatermark: '99',
    heartbeat: jest.fn().mockResolvedValue(),
    ...overrides,
  };
}

function makeMemoryDatabase() {
  const keys = new Set();
  const writes = [];

  const db = {
    writes,
    run: jest.fn(async (sql, params = []) => {
      if (sql.includes('INSERT INTO contract_events')) {
        const key = params[6];
        if (keys.has(key)) return { changes: 0 };
        keys.add(key);
        writes.push(params);
        return { changes: 1, id: writes.length };
      }
      return { changes: 1 };
    }),
    transaction: jest.fn(async (callback) => callback(db)),
  };

  return db;
}

function createConsumer(database, extra = {}) {
  return new KafkaEventConsumer({
    brokers: ['127.0.0.1:9092'],
    groupId: 'ledger-indexer',
    topics: ['soroban-ledger-events'],
    database,
    logger: silentLogger,
    ...extra,
  });
}

describe('Kafka ledger event consumer', () => {
  it('decodes JSON Kafka messages into indexed event records', () => {
    const event = decodeKafkaMessage(jsonMessage());

    expect(event).toMatchObject({
      contractId: CONTRACT_ID,
      ledgerSequence: 42,
      topics: ['transfer'],
      value: { amount: 10 },
      eventType: 'contract',
    });
    expect(event.kafka).toEqual(
      expect.objectContaining({
        topic: 'soroban-ledger-events',
        partition: 2,
        offset: '10',
        key: CONTRACT_ID,
      })
    );
    expect(event.eventKey).toMatch(/^[a-f0-9]{64}$/);
    expect(partitionKeyForEvent({ contractId: CONTRACT_ID })).toBe(CONTRACT_ID);
  });

  it('decodes base64 XDR topics and values', () => {
    const topicXdr = nativeToScVal('transfer', { type: 'symbol' }).toXDR(
      'base64'
    );
    const valueXdr = nativeToScVal(25, { type: 'i128' }).toXDR('base64');

    const event = decodeKafkaMessage(
      jsonMessage({
        value: Buffer.from(
          JSON.stringify({
            contractId: CONTRACT_ID,
            ledger: 43,
            topic: [topicXdr],
            value: { xdr: valueXdr },
          })
        ),
      })
    );

    expect(event.topics).toEqual(['transfer']);
    expect(event.value).toBe(25n);
    expect(event.rawXdr).toBe(valueXdr);
  });

  it('uses the contract ID as the ordering/partition key', () => {
    const payload = {
      contract_id: CONTRACT_ID,
      ledger_sequence: 50,
    };

    expect(partitionKeyForEvent(payload)).toBe(CONTRACT_ID);
    expect(partitionKeyForEvent({})).toBeUndefined();
  });

  it('persists a batch and commits the next offset after the database write', async () => {
    const database = makeMemoryDatabase();
    const consumer = createConsumer(database);
    const fakeConsumer = { commitOffsets: jest.fn().mockResolvedValue() };

    const result = await consumer.processBatch(
      batch([jsonMessage({ offset: '10' }), jsonMessage({ offset: '11' })]),
      fakeConsumer
    );

    expect(result).toEqual({
      processed: 2,
      inserted: 2,
      duplicates: 0,
      committedOffset: '12',
    });
    expect(database.writes).toHaveLength(2);
    expect(fakeConsumer.commitOffsets).toHaveBeenCalledWith([
      {
        topic: 'soroban-ledger-events',
        partition: 2,
        offset: '12',
      },
    ]);
  });

  it('is idempotent when Kafka redelivers the same offsets during failover', async () => {
    const database = makeMemoryDatabase();
    const consumer = createConsumer(database);
    const fakeConsumer = { commitOffsets: jest.fn().mockResolvedValue() };
    const redelivered = batch([
      jsonMessage({ offset: '20' }),
      jsonMessage({ offset: '21' }),
    ]);

    const first = await consumer.processBatch(redelivered, fakeConsumer);
    const second = await consumer.processBatch(redelivered, fakeConsumer);

    expect(first).toMatchObject({ inserted: 2, duplicates: 0 });
    expect(second).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(database.writes).toHaveLength(2);
    expect(database.run).toHaveBeenCalledTimes(4);
  });

  it('does not commit an offset when persistence fails', async () => {
    const database = makeMemoryDatabase();
    database.transaction.mockRejectedValueOnce(new Error('database offline'));
    const consumer = createConsumer(database);
    const fakeConsumer = { commitOffsets: jest.fn().mockResolvedValue() };

    await expect(
      consumer.processBatch(batch([jsonMessage()]), fakeConsumer)
    ).rejects.toThrow('database offline');

    expect(fakeConsumer.commitOffsets).not.toHaveBeenCalled();
  });

  it('rejects malformed messages instead of silently dropping events', async () => {
    const consumer = createConsumer(makeMemoryDatabase());
    const fakeConsumer = { commitOffsets: jest.fn().mockResolvedValue() };

    await expect(
      consumer.processBatch(
        batch([
          {
            offset: '30',
            value: Buffer.from(JSON.stringify({ ledger: 99 })),
          },
        ]),
        fakeConsumer
      )
    ).rejects.toThrow(/no contract ID/i);

    expect(fakeConsumer.commitOffsets).not.toHaveBeenCalled();
  });

  it('deduplicates against a real SQLite unique index', async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    sqlite.exec(`
      CREATE TABLE contract_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        ledger_sequence INTEGER NOT NULL,
        topics TEXT NOT NULL,
        value TEXT,
        raw_xdr TEXT,
        event_type TEXT DEFAULT 'contract',
        event_key TEXT,
        kafka_topic TEXT,
        kafka_partition INTEGER,
        kafka_offset TEXT,
        indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX idx_ce_event_key ON contract_events(event_key);
    `);

    const adapter = {
      run: (sql, params = []) => {
        sqlite.run(sql, params);
        return { changes: sqlite.getRowsModified() };
      },
      transaction: async (callback) => {
        sqlite.run('BEGIN');
        try {
          const result = await callback(adapter);
          sqlite.run('COMMIT');
          return result;
        } catch (error) {
          sqlite.run('ROLLBACK');
          throw error;
        }
      },
    };
    const consumer = createConsumer(adapter);
    const fakeConsumer = { commitOffsets: jest.fn().mockResolvedValue() };
    const redelivered = batch([jsonMessage({ offset: '40' })]);

    await consumer.processBatch(redelivered, fakeConsumer);
    await consumer.processBatch(redelivered, fakeConsumer);

    const result = sqlite.exec('SELECT COUNT(*) AS count FROM contract_events');
    expect(result[0].values[0][0]).toBe(1);
    sqlite.close();
  });

  it('computes bounded exponential backoff with jitter', () => {
    const noJitter = () => 1;
    expect(computeBackoffDelay(0, 500, 30_000, noJitter)).toBe(500);
    expect(computeBackoffDelay(1, 500, 30_000, noJitter)).toBe(1_000);
    expect(computeBackoffDelay(5, 500, 30_000, noJitter)).toBe(16_000);
    expect(computeBackoffDelay(20, 500, 30_000, noJitter)).toBe(30_000);
  });

  it('updates Prometheus lag gauges from committed and high-water offsets', async () => {
    const database = makeMemoryDatabase();
    const consumer = createConsumer(database);
    consumer.admin = {
      fetchTopicOffsets: jest.fn().mockResolvedValue([
        { partition: 0, offset: '100', high: '150', low: '0' },
        { partition: 1, offset: '50', high: '70', low: '0' },
      ]),
    };
    consumer.consumer = {
      fetchOffsets: jest.fn().mockResolvedValue([
        {
          topic: 'soroban-ledger-events',
          partitions: [
            { partition: 0, offset: '120' },
            { partition: 1, offset: '69' },
          ],
        },
      ]),
    };

    await consumer.refreshLag();

    const metric = await kafkaRecordsLagMax.get();
    expect(metric.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 30,
          labels: expect.objectContaining({
            topic: 'soroban-ledger-events',
          }),
        }),
      ])
    );
  });
});
