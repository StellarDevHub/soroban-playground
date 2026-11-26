import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs/promises';
import { TempCleanupService } from './temp-cleanup.service';

jest.mock('fs/promises');

describe('TempCleanupService', () => {
  let service: TempCleanupService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [TempCleanupService],
    }).compile();

    service = module.get<TempCleanupService>(TempCleanupService);
  });

  it('should identify and remove temp compile directories older than 30 minutes', async () => {
    const thirtyFiveMinutesAgo = Date.now() - 35 * 60 * 1000;

    (fs.readdir as jest.Mock)
      .mockResolvedValueOnce([
        { isDirectory: () => true, name: '.tmp_compile_active123' },
        { isDirectory: () => true, name: '.tmp_compile_stale456' },
        { isDirectory: () => true, name: 'other_dir' },
      ])
      .mockResolvedValue([]); // Empty sub-folder recursive reads

    (fs.stat as jest.Mock).mockResolvedValue({
      mtimeMs: thirtyFiveMinutesAgo,
      size: 1024 * 1024,
      isFile: () => true,
      isDirectory: () => false,
    });

    (fs.rm as jest.Mock).mockResolvedValue(undefined);

    const result = await service.cleanupWasmTempDirectories();

    expect(fs.rm).toHaveBeenCalledTimes(2);
    expect(result.deletedDirs).toBe(2);
  });

  it('should skip actively compiling directories that hold a lock file', async () => {
    const thirtyFiveMinutesAgo = Date.now() - 35 * 60 * 1000;

    (fs.readdir as jest.Mock)
      .mockResolvedValueOnce([
        { isDirectory: () => true, name: '.tmp_compile_locked789' },
      ])
      .mockResolvedValue([]);

    (fs.stat as jest.Mock).mockResolvedValue({
      mtimeMs: thirtyFiveMinutesAgo,
      size: 1024,
      isFile: () => true,
      isDirectory: () => false,
    });

    (fs.open as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }),
    );
    (fs.rm as jest.Mock).mockResolvedValue(undefined);

    const result = await service.cleanupWasmTempDirectories();

    expect(fs.rm).not.toHaveBeenCalled();
    expect(result.deletedDirs).toBe(0);
  });

  it('should continue cleanup when a single directory removal fails', async () => {
    const thirtyFiveMinutesAgo = Date.now() - 35 * 60 * 1000;

    (fs.readdir as jest.Mock)
      .mockResolvedValueOnce([
        { isDirectory: () => true, name: '.tmp_compile_a' },
        { isDirectory: () => true, name: '.tmp_compile_b' },
      ])
      .mockResolvedValue([]);

    (fs.stat as jest.Mock).mockResolvedValue({
      mtimeMs: thirtyFiveMinutesAgo,
      size: 1024,
      isFile: () => true,
      isDirectory: () => false,
    });

    (fs.open as jest.Mock).mockResolvedValue({ close: jest.fn().mockResolvedValue(undefined) });
    (fs.rm as jest.Mock)
      .mockRejectedValueOnce(new Error('EACCES: permission denied'))
      .mockResolvedValueOnce(undefined);

    const result = await service.cleanupWasmTempDirectories();

    expect(fs.rm).toHaveBeenCalledTimes(2);
    expect(result.deletedDirs).toBe(1);
  });
});
