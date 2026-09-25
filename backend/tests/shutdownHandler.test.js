import http from 'http';
import { setupGracefulShutdown } from '../src/shutdown.js';
import * as queueService from '../src/services/queueService.js';
import * as connection from '../src/database/connection.js';
import * as pool from '../src/database/pool.js';

describe('SIGTERM/SIGINT Graceful Shutdown Handler', () => {
  let mockServer;
  let mockWss;
  let mockKnex;

  beforeEach(() => {
    mockServer = {
      close: jest.fn((cb) => cb()),
    };
    mockWss = {
      clients: new Set(),
      close: jest.fn((cb) => cb()),
    };
    mockKnex = {
      destroy: jest.fn().mockResolvedValue(),
    };
  });

  it('stops accepting connections, drains queues, and closes database pools', async () => {
    const shutdownQueuesSpy = jest
      .spyOn(queueService, 'shutdownQueues')
      .mockResolvedValue();
    const closeDatabaseSpy = jest
      .spyOn(connection, 'closeDatabase')
      .mockResolvedValue();
    const endAllPoolsSpy = jest
      .spyOn(pool, 'endAllPools')
      .mockResolvedValue();

    const { handleSignal } = setupGracefulShutdown({
      server: mockServer,
      wss: mockWss,
      db: mockKnex,
      timeoutMs: 5000,
    });

    await handleSignal('SIGTERM');

    expect(mockServer.close).toHaveBeenCalledTimes(1);
    expect(mockWss.close).toHaveBeenCalledTimes(1);
    expect(shutdownQueuesSpy).toHaveBeenCalledTimes(1);
    expect(mockKnex.destroy).toHaveBeenCalledTimes(1);
    expect(closeDatabaseSpy).toHaveBeenCalledTimes(1);
    expect(endAllPoolsSpy).toHaveBeenCalledTimes(1);

    shutdownQueuesSpy.mockRestore();
    closeDatabaseSpy.mockRestore();
    endAllPoolsSpy.mockRestore();
  });
});
