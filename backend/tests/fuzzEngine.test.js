import { mkdtemp, writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FuzzEngine,
  classifyCrash,
  parseExecsPerSec,
} from '../src/services/fuzzer/fuzzEngine.js';

const fakeRunner = (workDir) => async (_cmd, args) => {
  const joined = args.join(' ');
  if (joined.includes('fuzz run')) {
    await mkdir(path.join(workDir, 'artifacts'), { recursive: true });
    await writeFile(path.join(workDir, 'artifacts', 'crash-abc'), 'BAD');
    return {
      code: 0,
      stdout: '#9 NEW cov: 5 exec/s: 24000',
      stderr: "thread panicked at 'boom'",
    };
  }
  if (joined.includes('tmin')) {
    await writeFile(path.join(workDir, 'artifacts', 'min-crash-abc'), 'B');
    return { code: 77, stdout: '', stderr: '' };
  }
  if (joined.includes('llvm-cov')) {
    await writeFile(
      path.join(workDir, 'coverage', 'index.html'),
      '<html></html>'
    );
    return { code: 0, stdout: '', stderr: '' };
  }
  return { code: 0, stdout: '', stderr: '' };
};

describe('FuzzEngine', () => {
  it('captures crashes, minimizes, and produces a coverage report', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'fuzz-'));
    const res = await new FuzzEngine(fakeRunner(workDir)).runCampaign({
      contractDir: '/tmp/c',
      target: 'fuzz_target_1',
      workDir,
      workers: 2,
      durationSec: 1,
    });
    expect(res.crashes).toHaveLength(1);
    expect(res.crashes[0].kind).toBe('panic');
    expect(await readFile(res.crashes[0].minimizedPath, 'utf8')).toBe('B');
    expect((await stat(res.crashes[0].reproPath)).isFile()).toBe(true);
    expect((await stat(res.coverageReport)).isFile()).toBe(true);
    expect(res.execsPerSecPerWorker).toBe(12000);
  });

  it('enforces strict container limits', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'fuzz-'));
    const seen = [];
    const runner = async (_c, args) => {
      seen.push(args.join(' '));
      return { code: 0, stdout: '', stderr: '' };
    };
    await new FuzzEngine(runner).runCampaign({
      contractDir: '/tmp/c',
      target: 't',
      workDir,
      memoryLimitMb: 512,
    });
    expect(seen[0]).toContain('--memory 512m');
    expect(seen[0]).toContain('--memory-swap 512m');
    expect(seen[0]).toContain('--network none');
  });

  it('classifies crash logs and parses exec/s', () => {
    expect(classifyCrash('ERROR: AddressSanitizer: heap-buffer-overflow')).toBe(
      'memory-corruption'
    );
    expect(classifyCrash('attempt to add with overflow')).toBe('overflow');
    expect(parseExecsPerSec('exec/s: 100\nexec/s: 300')).toBe(300);
  });
});
