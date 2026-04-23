// jest.mock calls are hoisted above imports by babel-jest
jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  stat: jest.fn(),
  rm: jest.fn(),
}));

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import { exec } from 'child_process';
import compileRouter from '../src/routes/compile.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api/compile', compileRouter);
app.use(errorHandler);

describe('POST /api/compile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.rm.mockResolvedValue(undefined);
  });

  it('returns 400 if no code is provided', async () => {
    const res = await request(app).post('/api/compile').send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      message: 'No code provided',
      statusCode: 400,
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('creates the temp directory and src subdirectory', async () => {
    fs.stat.mockResolvedValue({ size: 1024, birthtime: new Date() });
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));

    await request(app).post('/api/compile').send({ code: '#![no_std]' });

    expect(fs.mkdir).toHaveBeenCalledTimes(2);
    expect(fs.mkdir).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('.tmp_compile_'),
      { recursive: true }
    );
    expect(fs.mkdir).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('src'),
      { recursive: true }
    );
  });

  it('writes Cargo.toml with soroban project config and lib.rs with user code', async () => {
    fs.stat.mockResolvedValue({ size: 1024, birthtime: new Date() });
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));

    const code = 'fn hello() {}';
    await request(app).post('/api/compile').send({ code });

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('Cargo.toml'),
      expect.stringContaining('soroban_contract')
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('lib.rs'),
      code
    );
  });

  it('runs cargo build targeting wasm32 with a 30s timeout', async () => {
    fs.stat.mockResolvedValue({ size: 512, birthtime: new Date() });
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));

    await request(app).post('/api/compile').send({ code: 'valid code' });

    expect(exec).toHaveBeenCalledWith(
      'cargo build --target wasm32-unknown-unknown --release',
      expect.objectContaining({ timeout: 30000 }),
      expect.any(Function)
    );
  });

  it('returns 500 with stderr details when cargo build fails', async () => {
    const stderrOutput =
      'error[E0001]: expected expression\n  --> src/lib.rs:1:1';
    exec.mockImplementation((cmd, opts, cb) =>
      cb(new Error('cargo exited with code 1'), '', stderrOutput)
    );

    const res = await request(app)
      .post('/api/compile')
      .send({ code: 'bad code' });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      message: 'Compilation failed',
      statusCode: 500,
      details: {
        details: stderrOutput,
      },
    });
    expect(Array.isArray(res.body.details.logs)).toBe(true);
  });

  it('returns 200 with artifact metadata when WASM is generated', async () => {
    const fakeStats = {
      size: 2048,
      birthtime: new Date('2024-01-01T00:00:00.000Z'),
    };
    fs.stat.mockResolvedValue(fakeStats);
    exec.mockImplementation((cmd, opts, cb) =>
      cb(null, 'Compiling soroban_contract v0.0.0', '')
    );

    const res = await request(app)
      .post('/api/compile')
      .send({ code: 'valid code' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      status: 'success',
      message: 'Contract compiled successfully',
      artifact: {
        name: 'soroban_contract.wasm',
        sizeBytes: fakeStats.size,
      },
    });
    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  it('returns 500 when WASM file does not exist after a successful build', async () => {
    fs.stat.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );
    exec.mockImplementation((cmd, opts, cb) =>
      cb(null, '', 'warning: unused variable `x`')
    );

    const res = await request(app)
      .post('/api/compile')
      .send({ code: 'valid code' });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      message: 'WASM file not generated',
      statusCode: 500,
    });
  });

  it('checks for WASM at the expected release output path', async () => {
    fs.stat.mockResolvedValue({ size: 512, birthtime: new Date() });
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));

    await request(app).post('/api/compile').send({ code: 'valid code' });

    expect(fs.stat).toHaveBeenCalledWith(
      expect.stringContaining('soroban_contract.wasm')
    );
    expect(fs.stat).toHaveBeenCalledWith(
      expect.stringContaining('wasm32-unknown-unknown')
    );
  });

  it('cleans up the temp directory on successful compilation', async () => {
    fs.stat.mockResolvedValue({ size: 512, birthtime: new Date() });
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));

    await request(app).post('/api/compile').send({ code: 'valid code' });

    expect(fs.rm).toHaveBeenCalledWith(
      expect.stringContaining('.tmp_compile_'),
      { recursive: true, force: true }
    );
  });

  it('cleans up the temp directory on compilation failure', async () => {
    exec.mockImplementation((cmd, opts, cb) =>
      cb(new Error('build error'), '', 'error output')
    );

    await request(app).post('/api/compile').send({ code: 'bad code' });

    expect(fs.rm).toHaveBeenCalledWith(
      expect.stringContaining('.tmp_compile_'),
      { recursive: true, force: true }
    );
  });

  it('cleans up the temp directory when WASM is not found', async () => {
    fs.stat.mockRejectedValue(new Error('ENOENT'));
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));

    await request(app).post('/api/compile').send({ code: 'valid code' });

    expect(fs.rm).toHaveBeenCalledWith(
      expect.stringContaining('.tmp_compile_'),
      { recursive: true, force: true }
    );
  });
});
