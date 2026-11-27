function property(value, key) {
  if (value == null) return undefined;
  const member = value[key];
  return typeof member === 'function' ? member.call(value) : member;
}

function nameOf(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value == null) return undefined;
  if (typeof value.name === 'string') return value.name;
  const result = value.toString?.();
  return result && result !== '[object Object]' ? result : undefined;
}

function normalizeVariant(tag) {
  if (typeof tag !== 'string') return undefined;

  const prefixes = [
    'scSpecEntry',
    'scSpecType',
    'scSpecUdtUnionCase',
  ];
  for (const prefix of prefixes) {
    if (tag.startsWith(prefix)) {
      const suffix = tag.slice(prefix.length);
      return suffix ? suffix[0].toLowerCase() + suffix.slice(1) : undefined;
    }
  }

  const xdrPrefixes = [
    'SC_SPEC_ENTRY_',
    'SC_SPEC_TYPE_',
    'SC_SPEC_UDT_UNION_CASE_',
  ];
  for (const prefix of xdrPrefixes) {
    if (tag.startsWith(prefix)) {
      return tag
        .slice(prefix.length)
        .split('_')
        .map((part, index) =>
          /^V\d+$/.test(part)
            ? part
            : index === 0
              ? part.toLowerCase()
              : part[0] + part.slice(1).toLowerCase()
        )
        .join('');
    }
  }

  return tag;
}

function variantOf(value) {
  const tag =
    nameOf(property(value, 'switch')) ??
    nameOf(property(value, 'kind')) ??
    nameOf(property(value, 'type'));
  return normalizeVariant(tag);
}

function payloadOf(value) {
  const payload = property(value, 'value');
  return payload && typeof payload === 'object' ? payload : value;
}

function field(value, payload, key) {
  return property(payload, key) ?? property(value, key);
}

function text(value) {
  if (typeof value === 'string') return value;
  return nameOf(value);
}

function list(value) {
  return value == null ? [] : Array.from(value);
}

function optionalDoc(value) {
  const doc = text(value);
  return doc || undefined;
}

function enumTag(value, prefix) {
  const tag = nameOf(value);
  if (!tag) return undefined;
  const normalized = tag
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();
  const normalizedPrefix = prefix.toUpperCase();
  return (
    normalized
      .replace(new RegExp(`^${normalizedPrefix}_?`), '')
      .toLowerCase() || undefined
  );
}

function pointerEscape(value) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function hasDefinition(definitions, name) {
  if (Array.isArray(definitions)) {
    return definitions.some((definition) => definition.name === name);
  }
  if (definitions instanceof Set) return definitions.has(name);
  return (
    definitions != null &&
    Object.prototype.hasOwnProperty.call(definitions, name)
  );
}

function normalizeType(typeDef) {
  if (typeDef == null) return { type: 'unknown' };

  const kind = variantOf(typeDef);
  const payload = payloadOf(typeDef);

  switch (kind) {
    case 'option':
      return {
        type: 'option',
        value: normalizeType(field(typeDef, payload, 'value')),
      };
    case 'result':
      return {
        type: 'result',
        ok: normalizeType(field(typeDef, payload, 'okType')),
        error: normalizeType(field(typeDef, payload, 'errorType')),
      };
    case 'vec':
      return {
        type: 'vec',
        element: normalizeType(
          field(typeDef, payload, 'elementType') ??
            field(typeDef, payload, 'element')
        ),
      };
    case 'map':
      return {
        type: 'map',
        key: normalizeType(field(typeDef, payload, 'keyType')),
        value: normalizeType(
          field(typeDef, payload, 'valueType') ??
            field(typeDef, payload, 'valType')
        ),
      };
    case 'tuple':
      return {
        type: 'tuple',
        elements: list(
          field(typeDef, payload, 'typeDefs') ??
            field(typeDef, payload, 'types') ??
            field(typeDef, payload, 'value')
        ).map(normalizeType),
      };
    case 'bytesN':
      return {
        type: 'bytesN',
        length: Number(field(typeDef, payload, 'n')),
      };
    case 'udt':
      return {
        type: 'udt',
        name: text(field(typeDef, payload, 'name')) ?? 'UnknownType',
      };
    case 'val':
    case 'bool':
    case 'void':
    case 'error':
    case 'u32':
    case 'i32':
    case 'u64':
    case 'i64':
    case 'timepoint':
    case 'duration':
    case 'u128':
    case 'i128':
    case 'u256':
    case 'i256':
    case 'bytes':
    case 'string':
    case 'symbol':
    case 'address':
      return { type: kind };
    default:
      return { type: kind ?? 'unknown' };
  }
}

function typeToJsonSchema(type, definitions) {
  const normalized = type?.type ? type : normalizeType(type);

  switch (normalized.type) {
    case 'val':
    case 'unknown':
      return {};
    case 'bool':
      return { type: 'boolean' };
    case 'void':
      return { type: 'null' };
    case 'error':
    case 'u32':
    case 'i32':
    case 'u64':
    case 'i64':
    case 'timepoint':
    case 'duration':
    case 'u128':
    case 'i128':
    case 'u256':
    case 'i256':
      return { type: 'integer' };
    case 'bytes':
    case 'bytesN':
      return { type: 'string', contentEncoding: 'base64' };
    case 'string':
    case 'symbol':
    case 'address':
      return { type: 'string' };
    case 'option':
      return {
        anyOf: [
          typeToJsonSchema(normalized.value, definitions),
          { type: 'null' },
        ],
      };
    case 'result':
      return {
        oneOf: [
          typeToJsonSchema(normalized.ok, definitions),
          typeToJsonSchema(normalized.error, definitions),
        ],
      };
    case 'vec':
      return {
        type: 'array',
        items: typeToJsonSchema(normalized.element, definitions),
      };
    case 'map':
      return {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: typeToJsonSchema(normalized.key, definitions),
            value: typeToJsonSchema(normalized.value, definitions),
          },
          required: ['key', 'value'],
          additionalProperties: false,
        },
      };
    case 'tuple': {
      const items = (normalized.elements ?? []).map((item) =>
        typeToJsonSchema(item, definitions)
      );
      return {
        type: 'array',
        prefixItems: items,
        minItems: items.length,
        maxItems: items.length,
      };
    }
    case 'udt':
      return hasDefinition(definitions, normalized.name)
        ? { $ref: `#/$defs/${pointerEscape(normalized.name)}` }
        : {};
    default:
      return {};
  }
}

function parseField(specField) {
  const payload = payloadOf(specField);
  return {
    name: text(field(specField, payload, 'name')) ?? 'unnamed',
    type: normalizeType(field(specField, payload, 'type')),
    doc: optionalDoc(field(specField, payload, 'doc')),
  };
}

function enumCase(specCase) {
  const payload = payloadOf(specCase);
  return {
    name: text(field(specCase, payload, 'name')) ?? 'unnamed',
    value: Number(field(specCase, payload, 'value')),
    doc: optionalDoc(field(specCase, payload, 'doc')),
  };
}

function parseUnionCase(specCase) {
  const kind = variantOf(specCase);
  const payload = payloadOf(specCase);
  const name = text(field(specCase, payload, 'name')) ?? 'unnamed';
  const types = list(
    field(specCase, payload, 'types') ?? field(specCase, payload, 'typeDefs')
  ).map(normalizeType);

  return {
    name,
    type: kind === 'tupleV0' ? { type: 'tuple', elements: types } : undefined,
    doc: optionalDoc(field(specCase, payload, 'doc')),
  };
}

function definitionSchema(type, definitions) {
  switch (type.kind) {
    case 'udtStructV0': {
      const properties = Object.fromEntries(
        type.fields.map((item) => [
          item.name,
          typeToJsonSchema(item.type, definitions),
        ])
      );
      return {
        type: 'object',
        properties,
        required: type.fields.map((item) => item.name),
        additionalProperties: false,
        ...(type.doc ? { description: type.doc } : {}),
      };
    }
    case 'udtEnumV0':
      return {
        type: 'string',
        enum: type.cases.map((item) => item.name),
        ...(type.doc ? { description: type.doc } : {}),
      };
    case 'udtErrorEnumV0':
      return {
        type: 'integer',
        enum: type.cases.map((item) => item.value),
        ...(type.doc ? { description: type.doc } : {}),
      };
    case 'udtUnionV0':
      return {
        oneOf: type.cases.map((item) => ({
          type: 'object',
          properties: {
            [item.name]: item.type
              ? typeToJsonSchema(item.type, definitions)
              : { type: 'null' },
          },
          required: [item.name],
          additionalProperties: false,
        })),
        ...(type.doc ? { description: type.doc } : {}),
      };
    default:
      return {};
  }
}

function parseEventParam(specParam) {
  const payload = payloadOf(specParam);
  return {
    name: text(field(specParam, payload, 'name')) ?? 'unnamed',
    type: normalizeType(field(specParam, payload, 'type')),
    location:
      enumTag(
        field(specParam, payload, 'location'),
        'SC_SPEC_EVENT_PARAM_LOCATION'
      ) ?? 'unknown',
    doc: optionalDoc(field(specParam, payload, 'doc')),
  };
}

function eventSchema(event, definitions) {
  return {
    type: 'object',
    properties: Object.fromEntries(
      event.params.map((param) => [
        param.name,
        {
          ...typeToJsonSchema(param.type, definitions),
          'x-stellar-location': param.location,
          ...(param.doc ? { description: param.doc } : {}),
        },
      ])
    ),
    required: event.params.map((param) => param.name),
    additionalProperties: false,
    ...(event.doc ? { description: event.doc } : {}),
    ...(event.prefixTopics.length
      ? { 'x-stellar-prefix-topics': event.prefixTopics }
      : {}),
    ...(event.dataFormat ? { 'x-stellar-data-format': event.dataFormat } : {}),
  };
}

/**
 * Parses decoded ScSpecEntry values from stellar-sdk into functions, custom
 * types, error codes, and JSON schemas. XDR union discriminants are read by
 * name so the parser remains compatible as the SDK adds spec variants.
 */
export function parseContractAbi(specEntries) {
  if (!Array.isArray(specEntries)) {
    throw new TypeError('Contract spec entries must be an array');
  }

  const functions = [];
  const types = [];
  const events = [];
  const errors = [];
  const unsupportedEntries = [];

  for (const entry of specEntries) {
    const kind = variantOf(entry);
    const value = payloadOf(entry);
    const name = text(field(entry, value, 'name'));
    const doc = optionalDoc(field(entry, value, 'doc'));

    switch (kind) {
      case 'functionV0':
        functions.push({
          name: name ?? 'unnamed',
          doc,
          inputs: list(field(entry, value, 'inputs')).map(parseField),
          outputs: list(field(entry, value, 'outputs')).map(normalizeType),
        });
        break;
      case 'udtStructV0':
        types.push({
          kind,
          name: name ?? 'unnamed',
          lib: text(field(entry, value, 'lib')),
          doc,
          fields: list(field(entry, value, 'fields')).map(parseField),
        });
        break;
      case 'udtEnumV0':
      case 'udtErrorEnumV0': {
        const cases = list(field(entry, value, 'cases')).map(enumCase);
        const typeName = name ?? 'unnamed';
        types.push({
          kind,
          name: typeName,
          lib: text(field(entry, value, 'lib')),
          doc,
          cases,
        });
        if (kind === 'udtErrorEnumV0') {
          errors.push(...cases.map((item) => ({ ...item, type: typeName })));
        }
        break;
      }
      case 'udtUnionV0':
        types.push({
          kind,
          name: name ?? 'unnamed',
          lib: text(field(entry, value, 'lib')),
          doc,
          cases: list(field(entry, value, 'cases')).map(parseUnionCase),
        });
        break;
      case 'eventV0': {
        const prefixTopics = list(field(entry, value, 'prefixTopics')).map(
          text
        );
        events.push({
          name: name ?? 'unnamed',
          lib: text(field(entry, value, 'lib')),
          doc,
          prefixTopics,
          params: list(field(entry, value, 'params')).map(parseEventParam),
          dataFormat: enumTag(
            field(entry, value, 'dataFormat'),
            'SC_SPEC_EVENT_DATA_FORMAT'
          ),
        });
        break;
      }
      default:
        unsupportedEntries.push(kind ?? 'unknown');
    }
  }

  const definitions = Object.fromEntries(
    types.map((type) => [type.name, definitionSchema(type, types)])
  );
  const functionSchemas = Object.fromEntries(
    functions.map((fn) => [
      fn.name,
      {
        type: 'object',
        properties: Object.fromEntries(
          fn.inputs.map((input) => [
            input.name,
            typeToJsonSchema(input.type, definitions),
          ])
        ),
        required: fn.inputs.map((input) => input.name),
        additionalProperties: false,
      },
    ])
  );
  const eventSchemas = Object.fromEntries(
    events.map((event) => [
      event.name,
      eventSchema(event, definitions),
    ])
  );

  return {
    functions,
    types,
    events,
    errors,
    unsupportedEntries,
    functionSchemas,
    eventSchemas,
    jsonSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: definitions,
    },
  };
}

export { normalizeType, typeToJsonSchema };
