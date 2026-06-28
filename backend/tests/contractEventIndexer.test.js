import { jest } from '@jest/globals';

// Mock config before importing the indexer
jest.mock('../src/config/index.js', () => ({
  __esModule: true,
  default: {
    indexer: {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractIds: ['CABC123'],
      pollIntervalMs: 5000,
    },
  },
}));

// Mock stellar-sdk SorobanRpc
const mockGetEvents = jest.fn();
jest.mock('@stellar/stellar-sdk', () => ({
  SorobanRpc: {
    Server: jest.fn().mockImplementation(() => ({
      getEvents: mockGetEvents,
    })),
  },
  xdr: {
    ScVal: { fromXDR: jest.fn() },
  },
  scValToNative: jest.fn((v) => v),
}));

// Mock contractEventParser to control parseEvent behaviour
jest.mock('../src/services/contractEventParser.js', () => ({
  parseEvent: jest.fn(),
  dispatchEvent: jest.fn(),
  registerHandler: jest.fn(),
}));

import {
  parseEvent,
  dispatchEvent,
} from '../src/services/contractEventParser.js';

// Mock DatabaseService to use an in-memory store
const dbStore = { events: [], cursor: null };
jest.mock('../src/services/databaseService.js', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(),
      close: jest.fn().mockResolvedValue(),
      run: jest.fn().mockImplementation((sql, params = []) => {
        if (sql.includes('INSERT INTO contract_events')) {
          dbStore.events.push(params);
        }
        if (sql.includes('contract_event_cursor')) {
          dbStore.cursor = params[1]; // last_ledger
        }
        return Promise.resolve({ id: 1, changes: 1 });
      }),
      get: jest.fn().mockImplementation((sql) => {
        if (sql.includes('contract_event_cursor')) {
          return Promise.resolve(
            dbStore.cursor !== null ? { last_ledger: dbStore.cursor } : null
          );
        }
        return Promise.resolve(null);
      }),
    })),
  };
});

let ContractEventIndexer;

beforeAll(async () => {
  const mod = await import('../src/services/contractEventIndexer.js');
  // Access the class through the singleton's constructor
  ContractEventIndexer = mod.contractEventIndexer.constructor;
});

function makeIndexer() {
  const indexer = Object.create(ContractEventIndexer.prototype);
  indexer._rpcUrl = 'https://soroban-testnet.stellar.org';
  indexer._contractIds = ['CABC123'];
  indexer._intervalMs = 5000;
  indexer._timer = null;

  const { default: MockDB } = require('../src/services/databaseService.js');
  indexer._db = new MockDB();
  return indexer;
}

beforeEach(() => {
  jest.clearAllMocks();
  dbStore.events = [];
  dbStore.cursor = null;
});

describe('ContractEventIndexer', () => {
  it('saves cursor (last_ledger) after a successful poll batch', async () => {
    const raw = {
      contractId: 'CABC123',
      ledger: 42,
      topic: [],
      value: null,
      type: 'contract',
    };
    mockGetEvents.mockResolvedValue({ events: [raw], latestLedger: 42 });
    parseEvent.mockReturnValue({
      contractId: 'CABC123',
      ledgerSequence: 42,
      topics: [],
      value: null,
      rawXdr: null,
      eventType: 'contract',
    });

    const indexer = makeIndexer();
    await indexer._poll();

    expect(dbStore.cursor).toBe(42);
  });

  it('resumes from saved cursor on the next poll', async () => {
    dbStore.cursor = 100;
    mockGetEvents.mockResolvedValue({ events: [], latestLedger: 100 });

    const indexer = makeIndexer();
    await indexer._poll();

    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 100 })
    );
  });

  it('skips individual events that fail to parse without halting the loop', async () => {
    const raw1 = {
      contractId: 'CABC123',
      ledger: 10,
      topic: [],
      value: null,
      type: 'contract',
    };
    const raw2 = {
      contractId: 'CABC123',
      ledger: 11,
      topic: [],
      value: null,
      type: 'contract',
    };
    mockGetEvents.mockResolvedValue({ events: [raw1, raw2], latestLedger: 11 });

    parseEvent
      .mockImplementationOnce(() => {
        throw new Error('XDR parse failure');
      })
      .mockReturnValueOnce({
        contractId: 'CABC123',
        ledgerSequence: 11,
        topics: [],
        value: null,
        rawXdr: null,
        eventType: 'contract',
      });

    const indexer = makeIndexer();
    await expect(indexer._poll()).resolves.not.toThrow();

    // Second event was still processed
    expect(dbStore.events).toHaveLength(1);
  });

  it('inserts parsed events into contract_events table', async () => {
    const raw = {
      contractId: 'CABC123',
      ledger: 5,
      topic: [],
      value: null,
      type: 'contract',
    };
    mockGetEvents.mockResolvedValue({ events: [raw], latestLedger: 5 });
    parseEvent.mockReturnValue({
      contractId: 'CABC123',
      ledgerSequence: 5,
      topics: ['transfer'],
      value: { amount: 100 },
      rawXdr: 'base64xdr',
      eventType: 'contract',
    });

    const indexer = makeIndexer();
    await indexer._poll();

    expect(dbStore.events).toHaveLength(1);
    expect(dbStore.events[0][0]).toBe('CABC123');
    expect(dbStore.events[0][1]).toBe(5);
  });

  it('dispatches to registered handler for known contract type', async () => {
    const raw = {
      contractId: 'CABC123',
      ledger: 7,
      topic: [],
      value: null,
      type: 'contract',
    };
    mockGetEvents.mockResolvedValue({ events: [raw], latestLedger: 7 });
    const parsed = {
      contractId: 'CABC123',
      ledgerSequence: 7,
      topics: ['transfer'],
      value: null,
      rawXdr: null,
      eventType: 'contract',
    };
    parseEvent.mockReturnValue(parsed);

    const indexer = makeIndexer();
    await indexer._poll();

    expect(dispatchEvent).toHaveBeenCalledWith(parsed);
  });

  it('handles empty event batches without error', async () => {
    mockGetEvents.mockResolvedValue({ events: [], latestLedger: 0 });

    const indexer = makeIndexer();
    await expect(indexer._poll()).resolves.not.toThrow();
    expect(dbStore.events).toHaveLength(0);
  });
});
