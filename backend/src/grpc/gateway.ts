import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { context, propagation } from '@opentelemetry/api';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProtoLoaderOptions } from './protoLoaderOptions.js';

export type CompileRequest = {
  code: string;
  dependencies?: Record<string, string>;
  contract_name?: string;
  source?: string;
  source_code?: string;
};

export type CompileResponse = {
  success: boolean;
  status: string;
  hash: string;
  message: string;
  cached: boolean;
  duration_ms: string;
  logs: string[];
  artifact_name: string;
  artifact_size_bytes: string;
  artifact_path: string;
};

export type SimulateResponse = {
  success: boolean;
  status: string;
  data: Record<string, unknown>;
};

export type DeployResponse = {
  success: boolean;
  status: string;
  contract_id: string;
  contract_name: string;
  network: string;
  wasm_path: string;
  deployed_at: string;
  message: string;
};

type UnaryCallback<T> = (
  error: grpc.ServiceError | null,
  response?: T
) => void;
type UnaryCall<TRequest, TResponse> = (
  request: TRequest,
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
  callback: UnaryCallback<TResponse>
) => grpc.ClientUnaryCall;
type GatewayResponse = CompileResponse | SimulateResponse | DeployResponse;
type GatewayUnaryCall = (
  request: Record<string, unknown>,
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
  callback: UnaryCallback<GatewayResponse>
) => grpc.ClientUnaryCall;

export interface SorobanServiceClient extends grpc.Client {
  compile: UnaryCall<CompileRequest, CompileResponse>;
  simulate: UnaryCall<Record<string, string>, SimulateResponse>;
  deploy: UnaryCall<Record<string, string>, DeployResponse>;
  compileStream(
    metadata?: grpc.Metadata,
    options?: grpc.CallOptions
  ): grpc.ClientDuplexStream<CompileRequest, CompileResponse>;
}

interface ProtoField {
  type: string;
  rule?: string;
  map?: boolean;
  resolvedType?: {
    name?: string;
    fields?: Record<string, ProtoField>;
    values?: Record<string, number>;
  };
}

interface ProtoMessage {
  type: { fields: Record<string, ProtoField> };
}

interface ProtoMethod {
  path: string;
  requestStream: boolean;
  responseStream: boolean;
  requestType: ProtoMessage;
  responseType: ProtoMessage;
}

interface ProtoPackageDefinition {
  [key: string]: ProtoMessage | ProtoMethod;
}

interface HttpBinding {
  rpcName: string;
  requestType: string;
  responseType: string;
  path: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const protoPath = join(__dirname, 'soroban.proto');
const protoSource = readFileSync(protoPath, 'utf8');
const packageDefinition = protoLoader.loadSync(
  protoPath,
  createProtoLoaderOptions(__dirname)
);
const loadedProto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
  soroban_playground: {
    SorobanService: new (
      address: string,
      credentials: grpc.ChannelCredentials,
      options?: Record<string, string | number | boolean>
    ) => SorobanServiceClient;
  };
};
const definitions =
  packageDefinition as unknown as ProtoPackageDefinition;

export function createSorobanGrpcClient(
  address: string,
  credentials: grpc.ChannelCredentials = grpc.credentials.createInsecure(),
  options: Record<string, string | number | boolean> = {}
): SorobanServiceClient {
  return new loadedProto.soroban_playground.SorobanService(
    address,
    credentials,
    options
  );
}

const httpBindings: HttpBinding[] = [...protoSource.matchAll(
  /rpc\s+(\w+)\s*\(\s*(?:stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(?:stream\s+)?(\w+)\s*\)\s*\{([\s\S]*?)\}/g
)]
  .map((match) => {
    const path = match[4].match(/post:\s*"([^"]+)"/)?.[1];
    if (!path) return null;
    return {
      rpcName: match[1],
      requestType: match[2],
      responseType: match[3],
      path,
    };
  })
  .filter((binding): binding is HttpBinding => binding !== null);

function toOpenApiType(type: string): Record<string, unknown> {
  switch (type) {
    case 'bool':
      return { type: 'boolean' };
    case 'int32':
    case 'uint32':
      return { type: 'integer', format: 'int32' };
    case 'int64':
    case 'uint64':
      return { type: 'string', format: 'int64' };
    case 'double':
      return { type: 'number', format: 'double' };
    case 'float':
      return { type: 'number', format: 'float' };
    default:
      return { type: 'string' };
  }
}

function toJsonName(fieldName: string): string {
  return fieldName.replace(/_([a-z0-9])/g, (_match, character: string) =>
    character.toUpperCase()
  );
}

function messageSchema(name: string): Record<string, unknown> {
  const definition = definitions[`soroban_playground.${name}`] as
    | ProtoMessage
    | undefined;
  if (!definition || !('type' in definition)) {
    throw new Error(`Missing protobuf message definition: ${name}`);
  }

  const properties: Record<string, unknown> = {};
  for (const [fieldName, field] of Object.entries(definition.type.fields)) {
    let schema: Record<string, unknown>;
    if (field.map) {
      schema = {
        type: 'object',
        additionalProperties: toOpenApiType(field.type),
      };
    } else if (field.resolvedType?.fields && field.resolvedType.name) {
      schema = { $ref: `#/components/schemas/${field.resolvedType.name}` };
    } else if (field.resolvedType?.values) {
      schema = {
        type: 'string',
        enum: Object.keys(field.resolvedType.values),
      };
    } else {
      schema = toOpenApiType(field.type);
    }
    if (field.rule === 'repeated') {
      schema = { type: 'array', items: schema };
    }
    properties[toJsonName(fieldName)] = schema;
  }

  return { type: 'object', properties };
}

function addMessageSchema(name: string, schemas: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(schemas, name)) return;

  schemas[name] = { type: 'object', properties: {} };
  const definition = definitions[`soroban_playground.${name}`] as
    | ProtoMessage
    | undefined;
  if (!definition || !('type' in definition)) {
    throw new Error(`Missing protobuf message definition: ${name}`);
  }

  for (const field of Object.values(definition.type.fields)) {
    if (field.resolvedType?.fields && field.resolvedType.name) {
      addMessageSchema(field.resolvedType.name, schemas);
    }
  }
  schemas[name] = messageSchema(name);
}

export function buildGrpcOpenApiSpec() {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {
    ProblemDetails: {
      type: 'object',
      required: ['type', 'title', 'status', 'detail'],
      properties: {
        type: { type: 'string', format: 'uri-reference' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        instance: { type: 'string', format: 'uri-reference' },
        requestId: { type: 'string' },
      },
    },
  };

  for (const binding of httpBindings) {
    const serviceDefinition = definitions[
      'soroban_playground.SorobanService'
    ] as unknown as Record<string, ProtoMethod>;
    const method =
      serviceDefinition[binding.rpcName[0].toLowerCase() + binding.rpcName.slice(1)];
    if (!method) {
      throw new Error(`Missing protobuf RPC definition: ${binding.rpcName}`);
    }

    addMessageSchema(binding.requestType, schemas);
    addMessageSchema(binding.responseType, schemas);
    paths[binding.path] = {
      post: {
        operationId: binding.rpcName[0].toLowerCase() + binding.rpcName.slice(1),
        summary: `${binding.rpcName} Soroban request`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${binding.requestType}` },
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${binding.responseType}` },
              },
            },
          },
          default: {
            description: 'RFC 7807 Problem Details response',
            content: {
              'application/problem+json': {
                schema: { $ref: '#/components/schemas/ProblemDetails' },
              },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Soroban Playground gRPC Gateway',
      version: process.env.npm_package_version || '1.0.0',
      description:
        'REST transcoding and gRPC operations generated from soroban.proto.',
    },
    servers: [{ url: '/api/gateway' }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toProtoJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toProtoJson);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      toJsonName(key),
      toProtoJson(entry),
    ])
  );
}

function normalizeRequest(rpcName: string, body: Record<string, unknown>) {
  if (rpcName === 'Compile') {
    return {
      code:
        stringValue(body.code) ||
        stringValue(body.source) ||
        stringValue(body.sourceCode) ||
        '',
      dependencies:
        body.dependencies && typeof body.dependencies === 'object'
          ? body.dependencies
          : {},
      contract_name: stringValue(body.contractName) || '',
      source: stringValue(body.source) || '',
      source_code: stringValue(body.sourceCode) || '',
    };
  }
  if (rpcName === 'Simulate') {
    return {
      transaction_xdr:
        stringValue(body.transactionXdr) ||
        stringValue(body.transaction) ||
        '',
      network: stringValue(body.network) || 'testnet',
    };
  }
  return {
    wasm_path: stringValue(body.wasmPath) || '',
    contract_name: stringValue(body.contractName) || '',
    network: stringValue(body.network) || 'testnet',
    source_account: stringValue(body.sourceAccount) || '',
  };
}

function statusForGrpcError(code: number): number {
  switch (code) {
    case grpc.status.CANCELLED:
      return 499;
    case grpc.status.INVALID_ARGUMENT:
    case grpc.status.FAILED_PRECONDITION:
    case grpc.status.OUT_OF_RANGE:
      return 400;
    case grpc.status.UNAUTHENTICATED:
      return 401;
    case grpc.status.PERMISSION_DENIED:
      return 403;
    case grpc.status.NOT_FOUND:
      return 404;
    case grpc.status.ALREADY_EXISTS:
    case grpc.status.ABORTED:
      return 409;
    case grpc.status.RESOURCE_EXHAUSTED:
      return 429;
    case grpc.status.DEADLINE_EXCEEDED:
      return 504;
    case grpc.status.UNAVAILABLE:
      return 503;
    case grpc.status.UNIMPLEMENTED:
      return 501;
    default:
      return 500;
  }
}

function getGatewayDeadlineMs(): number {
  const value = Number(process.env.GRPC_GATEWAY_DEADLINE_MS || 120_000);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('GRPC_GATEWAY_DEADLINE_MS must be a positive integer');
  }
  return value;
}

function requestMetadata(req: express.Request): grpc.Metadata {
  const metadata = new grpc.Metadata();
  const cookieToken = req.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('accessToken='))
    ?.slice('accessToken='.length);
  const authorization =
    stringValue(req.headers.authorization) ||
    (cookieToken ? ['Bearer', String(cookieToken)].join(' ') : undefined);
  if (authorization) metadata.set('authorization', authorization);

  const requestId =
    stringValue(req.headers['x-request-id']) || randomUUID();
  req.res?.setHeader('x-request-id', requestId);
  metadata.set('x-request-id', requestId);

  const traceHeaders: Record<string, string> = {};
  propagation.inject(context.active(), traceHeaders);
  for (const key of ['traceparent', 'tracestate']) {
    const value =
      traceHeaders[key] || stringValue(req.headers[key]);
    if (value) metadata.set(key, value);
  }
  return metadata;
}

function invokeGrpc(
  client: SorobanServiceClient,
  binding: HttpBinding,
  request: Record<string, unknown>,
  metadata: grpc.Metadata,
  deadline: Date
): Promise<GatewayResponse> {
  const methods: Record<string, GatewayUnaryCall> = {
    Compile: (payload, callMetadata, options, callback) =>
      client.compile(
        payload as CompileRequest,
        callMetadata,
        options,
        (error, response) => callback(error, response)
      ),
    Simulate: (payload, callMetadata, options, callback) =>
      client.simulate(
        payload as Record<string, string>,
        callMetadata,
        options,
        (error, response) => callback(error, response)
      ),
    Deploy: (payload, callMetadata, options, callback) =>
      client.deploy(
        payload as Record<string, string>,
        callMetadata,
        options,
        (error, response) => callback(error, response)
      ),
  };
  const method = methods[binding.rpcName];
  if (!method) {
    return Promise.reject(
      new Error(`Unsupported REST binding: ${binding.rpcName}`)
    );
  }

  return new Promise((resolve, reject) => {
    method(request, metadata, { deadline }, (error, response) => {
      if (error) reject(error);
      else if (response) resolve(response);
      else reject(new Error(`gRPC ${binding.rpcName} returned no response`));
    });
  });
}

export function mountGrpcGateway(
  app: express.Express,
  options: { host?: string; port?: number; tls?: boolean } = {}
) {
  const host = options.host || process.env.GRPC_GATEWAY_HOST || '127.0.0.1';
  const port = options.port || Number(process.env.GRPC_PORT || 50051);
  const deadlineMs = getGatewayDeadlineMs();
  const tls = options.tls ?? process.env.GRPC_TLS === 'true';
  const channelOptions: Record<string, string | number | boolean> = {
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
    'grpc.max_send_message_length': 64 * 1024 * 1024,
    'grpc.keepalive_time_ms': 10_000,
    'grpc.keepalive_timeout_ms': 5_000,
  };
  if (tls && process.env.GRPC_TLS_SERVER_NAME) {
    channelOptions['grpc.ssl_target_name_override'] =
      process.env.GRPC_TLS_SERVER_NAME;
  }

  const credentials = tls
    ? grpc.credentials.createSsl(
        (() => {
          const rootCertPath =
            process.env.GRPC_ROOT_CERT_PATH || process.env.SSL_CERT_PATH;
          return rootCertPath ? readFileSync(rootCertPath) : undefined;
        })()
      )
    : grpc.credentials.createInsecure();
  const client = createSorobanGrpcClient(
    `${host}:${port}`,
    credentials,
    channelOptions
  );
  const router = express.Router();

  router.get('/openapi.json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildGrpcOpenApiSpec());
  });
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(buildGrpcOpenApiSpec(), {
      customSiteTitle: 'Soroban Playground gRPC Gateway',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    })
  );

  for (const binding of httpBindings) {
    router.post(binding.path, async (req, res) => {
      const metadata = requestMetadata(req);
      const deadline = setTimeout(() => {
        res.status(504).type('application/problem+json').json({
          type: 'about:blank',
          title: 'Gateway Timeout',
          status: 504,
          detail: 'The gRPC operation exceeded its deadline.',
          instance: req.originalUrl,
          requestId: metadata.get('x-request-id')[0],
        });
      }, deadlineMs);
      deadline.unref();

      try {
        const response = await invokeGrpc(
          client,
          binding,
          normalizeRequest(binding.rpcName, req.body || {}),
          metadata,
          new Date(Date.now() + deadlineMs)
        );
        if (res.headersSent) return;
        clearTimeout(deadline);
        res.json(toProtoJson(response));
      } catch (error) {
        if (res.headersSent) return;
        clearTimeout(deadline);
        const status = statusForGrpcError(
          Number.isInteger(error?.code) ? error.code : grpc.status.UNKNOWN
        );
        res
          .status(status)
          .type('application/problem+json')
          .json({
            type: `https://grpc.io/status/${error?.code ?? 'UNKNOWN'}`,
            title: error?.details || error?.message || 'gRPC request failed',
            status,
            detail: error?.details || error?.message || 'gRPC request failed',
            instance: req.originalUrl,
            requestId: metadata.get('x-request-id')[0],
          });
      } finally {
        clearTimeout(deadline);
      }
    });
  }

  app.use('/api/gateway', router);
  return {
    client,
    close() {
      client.close();
    },
  };
}
