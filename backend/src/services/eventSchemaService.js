import {
  eventQuarantineSize,
  eventSchemaBreakingChangesTotal,
  eventSchemaDetectionAlertsTotal,
  eventSchemaVersionEventsTotal,
  eventValidationTotal,
} from '../routes/metrics.js';

const SUPPORTED_FIELD_TYPES = new Set([
  'any',
  'array',
  'boolean',
  'integer',
  'number',
  'object',
  'string',
  'address',
  'iso_datetime',
]);

const MAX_ACCEPTED_EVENTS = 500;
const MAX_QUARANTINE_ITEMS = 500;
const MAX_SCHEMA_ALERTS = 200;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function parseVersion(version) {
  return String(version || '1.0.0')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function versionKey(eventType, version) {
  return `${eventType}@${version}`;
}

function fieldTypeForValue(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'any';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'object') return 'object';
  return 'any';
}

function normalizeFieldDefinition(name, definition = {}) {
  const field =
    typeof definition === 'string' ? { type: definition } : { ...definition };
  const type = String(field.type || 'any').toLowerCase();

  return {
    name,
    type: SUPPORTED_FIELD_TYPES.has(type) ? type : 'any',
    required: Boolean(field.required),
    deprecated: Boolean(field.deprecated),
    description: field.description || '',
    nullable: Boolean(field.nullable),
    default: field.default,
    enum: Array.isArray(field.enum) ? [...field.enum] : undefined,
    pattern: field.pattern,
    min: field.min,
    max: field.max,
    minLength: field.minLength,
    maxLength: field.maxLength,
  };
}

function normalizeFields(fields, required = [], deprecatedFields = []) {
  const normalized = {};
  const requiredSet = new Set(required);
  const deprecatedSet = new Set(deprecatedFields);

  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (!field || typeof field !== 'object' || !field.name) {
        continue;
      }
      const normalizedField = normalizeFieldDefinition(field.name, field);
      normalizedField.required =
        normalizedField.required || requiredSet.has(field.name);
      normalizedField.deprecated =
        normalizedField.deprecated || deprecatedSet.has(field.name);
      normalized[field.name] = normalizedField;
    }
    return normalized;
  }

  for (const [name, definition] of Object.entries(fields || {})) {
    const normalizedField = normalizeFieldDefinition(name, definition);
    normalizedField.required = normalizedField.required || requiredSet.has(name);
    normalizedField.deprecated =
      normalizedField.deprecated || deprecatedSet.has(name);
    normalized[name] = normalizedField;
  }

  for (const field of requiredSet) {
    if (normalized[field]) {
      normalized[field].required = true;
    }
  }

  for (const field of deprecatedSet) {
    if (normalized[field]) {
      normalized[field].deprecated = true;
    }
  }

  return normalized;
}

function normalizeSchema(input, registeredBy = 'system') {
  const eventType = input.eventType || input.event_type || input.type;
  const version = String(input.version || input.schemaVersion || '1.0.0');
  const fields = normalizeFields(
    input.fields || {},
    input.required || input.requiredFields || input.required_fields || [],
    input.deprecatedFields || input.deprecated_fields || []
  );

  const required = Object.values(fields)
    .filter((field) => field.required)
    .map((field) => field.name);
  const deprecatedFields = Object.values(fields)
    .filter((field) => field.deprecated)
    .map((field) => field.name);

  return {
    eventType,
    version,
    description: input.description || '',
    status: input.status || 'active',
    fields,
    required,
    deprecatedFields,
    additionalProperties: input.additionalProperties !== false,
    migrations: Array.isArray(input.migrations) ? clone(input.migrations) : [],
    createdAt: input.createdAt || nowIso(),
    registeredBy,
  };
}

function validateSchemaDefinition(schema) {
  const errors = [];

  if (!schema.eventType || typeof schema.eventType !== 'string') {
    errors.push('eventType is required');
  }

  if (!schema.version || typeof schema.version !== 'string') {
    errors.push('version is required');
  }

  if (!schema.fields || Object.keys(schema.fields).length === 0) {
    errors.push('fields must define at least one payload field');
  }

  for (const [fieldName, field] of Object.entries(schema.fields || {})) {
    if (!SUPPORTED_FIELD_TYPES.has(field.type)) {
      errors.push(`fields.${fieldName}.type is not supported`);
    }
    if (field.pattern) {
      try {
        new RegExp(field.pattern);
      } catch {
        errors.push(`fields.${fieldName}.pattern must be a valid RegExp`);
      }
    }
  }

  return errors;
}

function isCompatibleTypeChange(fromType, toType) {
  if (fromType === toType) return true;
  if (fromType === 'integer' && toType === 'number') return true;
  if (toType === 'any') return true;
  return false;
}

function analyzeEvolution(previousSchema, nextSchema) {
  if (!previousSchema) {
    return {
      compatible: true,
      breakingChanges: [],
      compatibleChanges: ['Initial schema version'],
      warnings: [],
      migrationGuide: ['No prior schema exists. Register this as the baseline.'],
    };
  }

  const breakingChanges = [];
  const compatibleChanges = [];
  const warnings = [];
  const previousFields = previousSchema.fields || {};
  const nextFields = nextSchema.fields || {};

  for (const [name, previousField] of Object.entries(previousFields)) {
    const nextField = nextFields[name];
    if (!nextField) {
      if (previousField.required || !previousField.deprecated) {
        breakingChanges.push(`Removed field "${name}"`);
      } else {
        compatibleChanges.push(`Removed previously deprecated field "${name}"`);
      }
      continue;
    }

    if (!isCompatibleTypeChange(previousField.type, nextField.type)) {
      breakingChanges.push(
        `Changed field "${name}" type from ${previousField.type} to ${nextField.type}`
      );
    }

    if (previousField.required && !nextField.required) {
      compatibleChanges.push(`Made required field "${name}" optional`);
    }

    if (!previousField.required && nextField.required && nextField.default === undefined) {
      breakingChanges.push(`Made optional field "${name}" required without a default`);
    }

    if (!previousField.deprecated && nextField.deprecated) {
      compatibleChanges.push(`Deprecated field "${name}"`);
    }

    if (
      Array.isArray(nextField.enum) &&
      (!Array.isArray(previousField.enum) ||
        nextField.enum.some((value) => !previousField.enum.includes(value)))
    ) {
      warnings.push(`Field "${name}" enum changed; verify downstream consumers`);
    }
  }

  for (const [name, nextField] of Object.entries(nextFields)) {
    if (previousFields[name]) {
      continue;
    }

    if (nextField.required && nextField.default === undefined) {
      breakingChanges.push(`Added required field "${name}" without a default`);
    } else {
      compatibleChanges.push(
        nextField.required
          ? `Added required field "${name}" with a default`
          : `Added optional field "${name}"`
      );
    }
  }

  if (
    previousSchema.additionalProperties &&
    nextSchema.additionalProperties === false
  ) {
    breakingChanges.push('Changed additionalProperties from true to false');
  }

  const migrationGuide =
    breakingChanges.length > 0
      ? breakingChanges.map((change) => `Resolve: ${change}`)
      : [
          'No breaking payload changes detected.',
          'Consumers can continue reading older events through the migration layer.',
        ];

  return {
    compatible: breakingChanges.length === 0,
    breakingChanges,
    compatibleChanges,
    warnings,
    migrationGuide,
  };
}

function normalizeEventEnvelope(input) {
  const source = input?.event && typeof input.event === 'object' ? input.event : input;
  const event = source || {};
  const eventType = event.eventType || event.event_type || event.type;
  const schemaVersion =
    event.schemaVersion || event.schema_version || event.version || undefined;
  const payload =
    event.payload && typeof event.payload === 'object'
      ? event.payload
      : event.data && typeof event.data === 'object'
        ? event.data
        : event.body && typeof event.body === 'object'
          ? event.body
          : undefined;

  return {
    id: event.id || event.eventId || event.event_id || undefined,
    eventType,
    schemaVersion,
    emittedAt: event.emittedAt || event.emitted_at || event.timestamp,
    contractId: event.contractId || event.contract_id,
    payload,
    raw: event,
  };
}

function validateType(value, field) {
  if (value === null || value === undefined) {
    return field.nullable || !field.required;
  }

  switch (field.type) {
    case 'any':
      return true;
    case 'array':
      return Array.isArray(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'address':
      return (
        typeof value === 'string' &&
        /^[CG][A-Z0-9]{55}$/.test(value)
      );
    case 'iso_datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    default:
      return true;
  }
}

function buildFieldConstraintErrors(field, value, path) {
  const errors = [];

  if (field.enum && !field.enum.includes(value)) {
    errors.push(`${path} must be one of: ${field.enum.join(', ')}`);
  }

  if (typeof value === 'number') {
    if (field.min !== undefined && value < field.min) {
      errors.push(`${path} must be greater than or equal to ${field.min}`);
    }
    if (field.max !== undefined && value > field.max) {
      errors.push(`${path} must be less than or equal to ${field.max}`);
    }
  }

  if (typeof value === 'string') {
    if (field.minLength !== undefined && value.length < field.minLength) {
      errors.push(`${path} must be at least ${field.minLength} characters`);
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      errors.push(`${path} must be at most ${field.maxLength} characters`);
    }
    if (field.pattern && !new RegExp(field.pattern).test(value)) {
      errors.push(`${path} does not match the required pattern`);
    }
  }

  return errors;
}

function createDefaultSchemas() {
  const legacyFields = {
    paymentId: { type: 'string', required: true },
    payer: { type: 'address', required: true },
    payee: { type: 'address', required: true },
    amount: { type: 'number', required: true, min: 0 },
    asset: { type: 'string', required: true },
    createdAt: { type: 'iso_datetime', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['pending', 'settled', 'failed'],
    },
  };

  const latestFields = {
    paymentId: { type: 'string', required: true },
    sourceAccount: { type: 'address', required: true },
    destinationAccount: { type: 'address', required: true },
    amount: { type: 'number', required: true, min: 0 },
    asset: { type: 'string', required: true },
    network: { type: 'string', required: true, default: 'testnet' },
    createdAt: { type: 'iso_datetime', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['pending', 'settled', 'failed'],
    },
    memo: { type: 'string', required: false, maxLength: 280 },
  };

  return [
    normalizeSchema(
      {
        eventType: 'pifp.payment',
        version: '1.0.0',
        description: 'Legacy PIFP payment lifecycle event.',
        fields: legacyFields,
        additionalProperties: false,
      },
      'seed'
    ),
    normalizeSchema(
      {
        eventType: 'pifp.payment',
        version: '2.0.0',
        description:
          'Current PIFP payment lifecycle event with explicit account roles and network.',
        fields: latestFields,
        additionalProperties: false,
        migrations: [
          {
            fromVersion: '1.0.0',
            toVersion: '2.0.0',
            rename: {
              payer: 'sourceAccount',
              payee: 'destinationAccount',
            },
            defaults: {
              network: 'testnet',
            },
          },
        ],
      },
      'seed'
    ),
  ];
}

class EventSchemaService {
  constructor() {
    this.resetForTests();
  }

  resetForTests() {
    this.schemas = new Map();
    this.acceptedEvents = [];
    this.quarantine = [];
    this.schemaAlerts = [];
    this.metrics = {
      validations: {
        total: 0,
        accepted: 0,
        quarantined: 0,
        rejected: 0,
      },
      versionDistribution: {},
      eventTypeDistribution: {},
    };

    for (const schema of createDefaultSchemas()) {
      this.schemas.set(versionKey(schema.eventType, schema.version), schema);
    }

    this.updateQuarantineGauge();
  }

  updateQuarantineGauge() {
    const openCount = this.quarantine.filter((item) => item.status === 'open').length;
    eventQuarantineSize.set(openCount);
  }

  recordValidationMetric(eventType, version, outcome) {
    const labels = {
      event_type: eventType || 'unknown',
      schema_version: version || 'unknown',
      outcome,
    };
    eventValidationTotal.inc(labels);
  }

  recordAcceptedMetric(eventType, version) {
    eventSchemaVersionEventsTotal.inc({
      event_type: eventType || 'unknown',
      schema_version: version || 'unknown',
    });

    if (!this.metrics.versionDistribution[eventType]) {
      this.metrics.versionDistribution[eventType] = {};
    }
    this.metrics.versionDistribution[eventType][version] =
      (this.metrics.versionDistribution[eventType][version] || 0) + 1;
    this.metrics.eventTypeDistribution[eventType] =
      (this.metrics.eventTypeDistribution[eventType] || 0) + 1;
  }

  listSchemas(eventType) {
    const schemas = [...this.schemas.values()]
      .filter((schema) => !eventType || schema.eventType === eventType)
      .sort((a, b) => {
        if (a.eventType !== b.eventType) {
          return a.eventType.localeCompare(b.eventType);
        }
        return compareVersions(a.version, b.version);
      });

    return clone(schemas);
  }

  getSchema(eventType, version) {
    if (!eventType) return null;

    if (version) {
      return this.schemas.get(versionKey(eventType, version)) || null;
    }

    const versions = [...this.schemas.values()]
      .filter((schema) => schema.eventType === eventType)
      .sort((a, b) => compareVersions(b.version, a.version));

    return versions[0] || null;
  }

  registerSchema(input, options = {}) {
    const schema = normalizeSchema(input, options.registeredBy || 'api');
    const definitionErrors = validateSchemaDefinition(schema);

    if (definitionErrors.length > 0) {
      return {
        registered: false,
        statusCode: 400,
        errors: definitionErrors,
      };
    }

    if (this.schemas.has(versionKey(schema.eventType, schema.version))) {
      return {
        registered: false,
        statusCode: 409,
        errors: [`Schema ${schema.eventType}@${schema.version} already exists`],
      };
    }

    const previous = this.getSchema(schema.eventType);
    const evolution = analyzeEvolution(previous, schema);

    if (!evolution.compatible && !options.allowBreaking) {
      eventSchemaBreakingChangesTotal.inc({ event_type: schema.eventType });
      this.addSchemaAlert({
        eventType: schema.eventType,
        severity: 'breaking',
        message: `Rejected ${schema.version}: ${evolution.breakingChanges.join('; ')}`,
        diff: evolution,
      });
      return {
        registered: false,
        statusCode: 409,
        errors: evolution.breakingChanges,
        evolution,
      };
    }

    if (!evolution.compatible) {
      eventSchemaBreakingChangesTotal.inc({ event_type: schema.eventType });
    }

    this.schemas.set(versionKey(schema.eventType, schema.version), schema);

    return {
      registered: true,
      schema: clone(schema),
      evolution,
    };
  }

  validateEvent(input, options = {}) {
    const envelope = normalizeEventEnvelope(input);
    const errors = [];
    const warnings = [];

    if (!envelope.eventType) {
      errors.push({
        path: 'eventType',
        code: 'required',
        message: 'eventType is required',
      });
    }

    if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
      errors.push({
        path: 'payload',
        code: 'invalid_type',
        message: 'payload must be an object',
      });
    }

    const schema =
      envelope.eventType &&
      this.getSchema(envelope.eventType, envelope.schemaVersion);

    if (envelope.eventType && !schema) {
      errors.push({
        path: 'schemaVersion',
        code: 'unknown_schema',
        message: envelope.schemaVersion
          ? `No schema registered for ${envelope.eventType}@${envelope.schemaVersion}`
          : `No schema registered for ${envelope.eventType}`,
      });
    }

    if (!envelope.schemaVersion && schema) {
      warnings.push({
        path: 'schemaVersion',
        code: 'inferred_latest',
        message: `schemaVersion was omitted; inferred latest ${schema.version}`,
      });
    }

    if (schema && envelope.payload && typeof envelope.payload === 'object' && !Array.isArray(envelope.payload)) {
      for (const fieldName of schema.required) {
        if (
          envelope.payload[fieldName] === undefined ||
          envelope.payload[fieldName] === null
        ) {
          errors.push({
            path: `payload.${fieldName}`,
            code: 'required',
            message: `${fieldName} is required`,
          });
        }
      }

      for (const [fieldName, value] of Object.entries(envelope.payload)) {
        const field = schema.fields[fieldName];

        if (!field) {
          if (!schema.additionalProperties) {
            errors.push({
              path: `payload.${fieldName}`,
              code: 'unknown_field',
              message: `${fieldName} is not defined in schema ${schema.version}`,
            });
          } else {
            warnings.push({
              path: `payload.${fieldName}`,
              code: 'unknown_field',
              message: `${fieldName} is not defined in schema ${schema.version}`,
            });
          }
          continue;
        }

        if (field.deprecated) {
          warnings.push({
            path: `payload.${fieldName}`,
            code: 'deprecated_field',
            message: `${fieldName} is deprecated in schema ${schema.version}`,
          });
        }

        if (!validateType(value, field)) {
          errors.push({
            path: `payload.${fieldName}`,
            code: 'invalid_type',
            message: `${fieldName} must be ${field.type}`,
          });
          continue;
        }

        for (const message of buildFieldConstraintErrors(
          field,
          value,
          `payload.${fieldName}`
        )) {
          errors.push({
            path: `payload.${fieldName}`,
            code: 'constraint',
            message,
          });
        }
      }
    }

    const version = schema?.version || envelope.schemaVersion || 'unknown';
    const eventType = envelope.eventType || 'unknown';
    const valid = errors.length === 0;

    if (options.recordMetric) {
      this.metrics.validations.total += 1;
      if (valid) {
        this.metrics.validations.accepted += 1;
        this.recordValidationMetric(eventType, version, 'accepted');
        this.recordAcceptedMetric(eventType, version);
      } else {
        const outcome = options.outcome || 'rejected';
        this.metrics.validations[outcome] += 1;
        this.recordValidationMetric(eventType, version, outcome);
      }
    }

    return {
      valid,
      eventType: envelope.eventType,
      schemaVersion: schema?.version || envelope.schemaVersion,
      schema: schema ? clone(schema) : null,
      errors,
      warnings,
    };
  }

  ingestEvent(input, options = {}) {
    const validation = this.validateEvent(input, {
      recordMetric: true,
      outcome: options.quarantineInvalid === false ? 'rejected' : 'quarantined',
    });

    if (!validation.valid) {
      if (options.quarantineInvalid === false) {
        return {
          accepted: false,
          quarantined: false,
          validation,
        };
      }

      const quarantineItem = this.quarantineEvent(input, validation);
      return {
        accepted: false,
        quarantined: true,
        validation,
        quarantineItem,
      };
    }

    const envelope = normalizeEventEnvelope(input);
    const record = {
      id: envelope.id || `evt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      eventType: validation.eventType,
      schemaVersion: validation.schemaVersion,
      emittedAt: envelope.emittedAt || nowIso(),
      contractId: envelope.contractId,
      payload: clone(envelope.payload),
      ingestedAt: nowIso(),
    };

    this.acceptedEvents.push(record);
    if (this.acceptedEvents.length > MAX_ACCEPTED_EVENTS) {
      this.acceptedEvents.shift();
    }

    return {
      accepted: true,
      quarantined: false,
      validation,
      event: clone(record),
    };
  }

  quarantineEvent(input, validation) {
    const envelope = normalizeEventEnvelope(input);
    const item = {
      id: `q-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      eventType: validation.eventType || envelope.eventType || 'unknown',
      schemaVersion: validation.schemaVersion || envelope.schemaVersion || 'unknown',
      status: 'open',
      receivedAt: nowIso(),
      errors: validation.errors,
      warnings: validation.warnings,
      event: clone(input),
      reviewNotes: '',
    };

    this.quarantine.unshift(item);
    if (this.quarantine.length > MAX_QUARANTINE_ITEMS) {
      this.quarantine.pop();
    }
    this.updateQuarantineGauge();

    return clone(item);
  }

  listQuarantine(status) {
    return clone(
      this.quarantine.filter((item) => !status || item.status === status)
    );
  }

  updateQuarantineItem(id, updates = {}) {
    const item = this.quarantine.find((entry) => entry.id === id);
    if (!item) return null;

    if (updates.status) {
      item.status = updates.status;
    }
    if (updates.reviewNotes !== undefined || updates.review_notes !== undefined) {
      item.reviewNotes = updates.reviewNotes ?? updates.review_notes ?? '';
    }
    item.reviewedAt = nowIso();
    this.updateQuarantineGauge();

    return clone(item);
  }

  reprocessQuarantinedEvent(id, overrideEvent) {
    const item = this.quarantine.find((entry) => entry.id === id);
    if (!item) return null;

    const event = overrideEvent || item.event;
    const result = this.ingestEvent(event, { quarantineInvalid: false });

    if (result.accepted) {
      item.status = 'reprocessed';
      item.reprocessedAt = nowIso();
      item.reprocessedEventId = result.event.id;
    } else {
      item.status = 'open';
      item.errors = result.validation.errors;
      item.warnings = result.validation.warnings;
      item.lastReprocessAt = nowIso();
    }

    this.updateQuarantineGauge();

    return {
      quarantineItem: clone(item),
      result,
    };
  }

  findMigrationRule(fromVersion, toVersion, eventType) {
    const targetSchema = this.getSchema(eventType, toVersion);
    return (
      targetSchema?.migrations?.find(
        (migration) =>
          migration.fromVersion === fromVersion &&
          migration.toVersion === toVersion
      ) || null
    );
  }

  getMigrationPath(eventType, fromVersion, toVersion) {
    const versions = this.listSchemas(eventType)
      .map((schema) => schema.version)
      .sort(compareVersions);
    const fromIndex = versions.indexOf(fromVersion);
    const toIndex = versions.indexOf(toVersion);

    if (fromIndex === -1 || toIndex === -1 || fromIndex > toIndex) {
      return null;
    }

    return versions.slice(fromIndex, toIndex + 1);
  }

  applyMigrationStep(event, fromVersion, toVersion) {
    const rule = this.findMigrationRule(fromVersion, toVersion, event.eventType);
    const nextSchema = this.getSchema(event.eventType, toVersion);
    const payload = clone(event.payload || {});

    if (rule?.rename) {
      for (const [fromField, toField] of Object.entries(rule.rename)) {
        if (payload[fromField] !== undefined && payload[toField] === undefined) {
          payload[toField] = payload[fromField];
        }
        delete payload[fromField];
      }
    }

    if (rule?.drop) {
      for (const fieldName of rule.drop) {
        delete payload[fieldName];
      }
    }

    const defaults = {
      ...(rule?.defaults || {}),
    };

    for (const [fieldName, field] of Object.entries(nextSchema?.fields || {})) {
      if (payload[fieldName] === undefined && field.default !== undefined) {
        defaults[fieldName] = field.default;
      }
    }

    for (const [fieldName, defaultValue] of Object.entries(defaults)) {
      if (payload[fieldName] === undefined) {
        payload[fieldName] = defaultValue;
      }
    }

    return {
      ...event,
      schemaVersion: toVersion,
      payload,
    };
  }

  migrateEvent(input, targetVersion) {
    const envelope = normalizeEventEnvelope(input);
    if (!envelope.eventType) {
      return {
        migrated: false,
        errors: ['eventType is required'],
      };
    }

    const targetSchema = this.getSchema(envelope.eventType, targetVersion);
    const sourceSchema = this.getSchema(envelope.eventType, envelope.schemaVersion);
    const latestSchema = this.getSchema(envelope.eventType);
    const resolvedTargetVersion =
      targetVersion || latestSchema?.version || envelope.schemaVersion;

    if (!sourceSchema) {
      return {
        migrated: false,
        errors: [
          `No source schema registered for ${envelope.eventType}@${envelope.schemaVersion}`,
        ],
      };
    }

    if (!targetSchema && targetVersion) {
      return {
        migrated: false,
        errors: [
          `No target schema registered for ${envelope.eventType}@${targetVersion}`,
        ],
      };
    }

    const sourceValidation = this.validateEvent(input);
    if (!sourceValidation.valid) {
      return {
        migrated: false,
        errors: sourceValidation.errors.map((error) => error.message),
        validation: sourceValidation,
      };
    }

    let event = {
      id: envelope.id,
      eventType: envelope.eventType,
      schemaVersion: envelope.schemaVersion,
      emittedAt: envelope.emittedAt,
      contractId: envelope.contractId,
      payload: clone(envelope.payload),
    };

    if (event.schemaVersion === resolvedTargetVersion) {
      return {
        migrated: true,
        event,
        migrationPath: [resolvedTargetVersion],
        validation: sourceValidation,
      };
    }

    const path = this.getMigrationPath(
      envelope.eventType,
      event.schemaVersion,
      resolvedTargetVersion
    );

    if (!path) {
      return {
        migrated: false,
        errors: [
          `No migration path from ${event.schemaVersion} to ${resolvedTargetVersion}`,
        ],
      };
    }

    for (let index = 0; index < path.length - 1; index += 1) {
      event = this.applyMigrationStep(event, path[index], path[index + 1]);
    }

    const validation = this.validateEvent(event);
    return {
      migrated: validation.valid,
      event,
      migrationPath: path,
      validation,
      errors: validation.errors.map((error) => error.message),
    };
  }

  readEvents(options = {}) {
    const { eventType, targetVersion } = options;
    return this.acceptedEvents
      .filter((event) => !eventType || event.eventType === eventType)
      .map((event) => {
        if (!targetVersion || event.schemaVersion === targetVersion) {
          return clone(event);
        }
        const migration = this.migrateEvent(event, targetVersion);
        return migration.migrated ? migration.event : clone(event);
      });
  }

  detectSchema(input) {
    const envelope = normalizeEventEnvelope(input);
    const detectedFields = {};

    for (const [name, value] of Object.entries(envelope.payload || {})) {
      detectedFields[name] = {
        type: fieldTypeForValue(value),
        required: true,
      };
    }

    return {
      eventType: envelope.eventType,
      version: envelope.schemaVersion || 'detected',
      fields: detectedFields,
      required: Object.keys(detectedFields),
    };
  }

  detectSchemaChanges(input) {
    const detected = this.detectSchema(input);
    const latest = detected.eventType ? this.getSchema(detected.eventType) : null;

    if (!latest) {
      const alert = {
        eventType: detected.eventType || 'unknown',
        severity: 'new_schema',
        message: 'No registered schema exists for this event type',
        detected,
        migrationGuide: ['Register the detected schema as version 1.0.0.'],
      };
      this.addSchemaAlert(alert);
      return {
        detected,
        latest: null,
        changes: {
          addedFields: Object.keys(detected.fields || {}),
          missingRequiredFields: [],
          typeChanges: [],
        },
        compatible: true,
        alert,
      };
    }

    const changes = {
      addedFields: [],
      missingRequiredFields: [],
      typeChanges: [],
      deprecatedFieldsSeen: [],
    };

    for (const [name, field] of Object.entries(detected.fields || {})) {
      const registered = latest.fields[name];
      if (!registered) {
        changes.addedFields.push(name);
      } else if (!isCompatibleTypeChange(registered.type, field.type)) {
        changes.typeChanges.push({
          field: name,
          expected: registered.type,
          detected: field.type,
        });
      }
      if (registered?.deprecated) {
        changes.deprecatedFieldsSeen.push(name);
      }
    }

    for (const fieldName of latest.required) {
      if (!detected.fields[fieldName]) {
        changes.missingRequiredFields.push(fieldName);
      }
    }

    const breaking =
      changes.missingRequiredFields.length > 0 ||
      changes.typeChanges.length > 0 ||
      (!latest.additionalProperties && changes.addedFields.length > 0);

    const migrationGuide = [];
    if (changes.addedFields.length > 0) {
      migrationGuide.push(
        `Review new fields: ${changes.addedFields.join(', ')}. Add them as optional fields or provide defaults before making them required.`
      );
    }
    if (changes.missingRequiredFields.length > 0) {
      migrationGuide.push(
        `Restore or migrate required fields: ${changes.missingRequiredFields.join(', ')}.`
      );
    }
    if (changes.typeChanges.length > 0) {
      migrationGuide.push(
        'Add an explicit migration for detected type changes before registering a new version.'
      );
    }
    if (migrationGuide.length === 0) {
      migrationGuide.push('No schema drift detected against the latest version.');
    }

    const alert = {
      eventType: detected.eventType,
      severity: breaking ? 'breaking' : 'compatible',
      message: breaking
        ? 'Detected event shape is not backward compatible'
        : 'Detected event shape is compatible with the latest schema',
      detected,
      latestVersion: latest.version,
      changes,
      migrationGuide,
    };

    if (breaking || changes.addedFields.length > 0 || changes.deprecatedFieldsSeen.length > 0) {
      this.addSchemaAlert(alert);
    }

    return {
      detected,
      latest: clone(latest),
      changes,
      compatible: !breaking,
      alert,
    };
  }

  addSchemaAlert(alert) {
    const item = {
      id: `alert-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      createdAt: nowIso(),
      ...clone(alert),
    };
    this.schemaAlerts.unshift(item);
    if (this.schemaAlerts.length > MAX_SCHEMA_ALERTS) {
      this.schemaAlerts.pop();
    }
    eventSchemaDetectionAlertsTotal.inc({
      event_type: item.eventType || 'unknown',
      severity: item.severity || 'unknown',
    });
    return clone(item);
  }

  listSchemaAlerts() {
    return clone(this.schemaAlerts);
  }

  getQualityMetrics() {
    const total = this.metrics.validations.total;
    const successRate =
      total === 0 ? 1 : this.metrics.validations.accepted / total;

    return {
      validations: {
        ...this.metrics.validations,
        successRate,
      },
      versionDistribution: clone(this.metrics.versionDistribution),
      eventTypeDistribution: clone(this.metrics.eventTypeDistribution),
      quarantine: {
        total: this.quarantine.length,
        open: this.quarantine.filter((item) => item.status === 'open').length,
        reprocessed: this.quarantine.filter(
          (item) => item.status === 'reprocessed'
        ).length,
      },
      schemas: {
        eventTypes: new Set([...this.schemas.values()].map((schema) => schema.eventType)).size,
        versions: this.schemas.size,
      },
      alerts: {
        total: this.schemaAlerts.length,
        breaking: this.schemaAlerts.filter((alert) => alert.severity === 'breaking').length,
      },
      generatedAt: nowIso(),
    };
  }
}

const eventSchemaService = new EventSchemaService();

export {
  analyzeEvolution,
  normalizeEventEnvelope,
  normalizeSchema,
};

export default eventSchemaService;
