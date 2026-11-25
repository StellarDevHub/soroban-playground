import { parseContractAbi } from '../src/services/contractAbiParser.js';

const xdrValue = (value) => () => value;
const xdrEnum = (name) => ({ name, toString: () => name });
const xdrVariant = (kind, value) => ({
  switch: xdrValue(xdrEnum(kind)),
  value: xdrValue(value),
});
const specType = (kind, value = {}) => xdrVariant(kind, value);
const specEntry = (kind, value) => xdrVariant(kind, value);
const field = (name, type, doc = '') => ({
  name: xdrValue(name),
  type: xdrValue(type),
  doc: xdrValue(doc),
});

describe('contractAbiParser', () => {
  it.each(['v20', 'v21', 'v22'])(
    'parses function specs built with SDK %s XDR layouts',
    () => {
      const spec = [
        specEntry('functionV0', {
          name: xdrValue('transfer'),
          doc: xdrValue('Move tokens between addresses'),
          inputs: xdrValue([
            field('from', specType('address')),
            field(
              'amount',
              specType('option', {
                value: xdrValue(specType('u128')),
              })
            ),
          ]),
          outputs: xdrValue([specType('bool')]),
        }),
      ];

      const parsed = parseContractAbi(spec);

      expect(parsed.functions).toEqual([
        {
          name: 'transfer',
          doc: 'Move tokens between addresses',
          inputs: [
            { name: 'from', type: { type: 'address' }, doc: undefined },
            {
              name: 'amount',
              type: { type: 'option', value: { type: 'u128' } },
              doc: undefined,
            },
          ],
          outputs: [{ type: 'bool' }],
        },
      ]);
      expect(parsed.functionSchemas.transfer.properties.amount).toEqual({
        anyOf: [{ type: 'integer' }, { type: 'null' }],
      });
    }
  );

  it('creates schemas and references for structs, enums, unions, and error codes', () => {
    const parsed = parseContractAbi([
      specEntry('udtStructV0', {
        name: xdrValue('Account'),
        doc: xdrValue('Account record'),
        fields: xdrValue([field('owner', specType('address'))]),
      }),
      specEntry('udtEnumV0', {
        name: xdrValue('Status'),
        cases: xdrValue([
          { name: xdrValue('active'), value: xdrValue(0) },
          { name: xdrValue('closed'), value: xdrValue(1) },
        ]),
      }),
      specEntry('udtUnionV0', {
        name: xdrValue('Balance'),
        cases: xdrValue([
          xdrVariant('voidV0', { name: xdrValue('none') }),
          xdrVariant('tupleV0', {
            name: xdrValue('token'),
            types: xdrValue([specType('address'), specType('u64')]),
          }),
        ]),
      }),
      specEntry('udtErrorEnumV0', {
        name: xdrValue('ContractError'),
        cases: xdrValue([
          {
            name: xdrValue('not_found'),
            value: xdrValue(404),
            doc: xdrValue('The item was not found'),
          },
        ]),
      }),
      specEntry('functionV0', {
        name: xdrValue('get_account'),
        inputs: xdrValue([]),
        outputs: xdrValue([
          specType('udt', { name: xdrValue('Account') }),
        ]),
      }),
    ]);

    expect(parsed.jsonSchema.$defs.Account).toMatchObject({
      type: 'object',
      properties: { owner: { type: 'string' } },
      required: ['owner'],
    });
    expect(parsed.jsonSchema.$defs.Status).toEqual({
      type: 'string',
      enum: ['active', 'closed'],
    });
    expect(parsed.jsonSchema.$defs.Balance.oneOf).toHaveLength(2);
    expect(parsed.jsonSchema.$defs.ContractError).toEqual({
      type: 'integer',
      enum: [404],
    });
    expect(parsed.errors).toEqual([
      {
        name: 'not_found',
        value: 404,
        doc: 'The item was not found',
        type: 'ContractError',
      },
    ]);
    expect(parsed.functions[0].outputs).toEqual([
      { type: 'udt', name: 'Account' },
    ]);
  });

  it('normalizes container and unknown spec variants without failing', () => {
    const parsed = parseContractAbi([
      specEntry('functionV0', {
        name: xdrValue('submit'),
        inputs: xdrValue([
          field(
            'payload',
            specType('tuple', {
              typeDefs: xdrValue([
                specType('vec', {
                  elementType: xdrValue(specType('string')),
                }),
                specType('map', {
                  keyType: xdrValue(specType('symbol')),
                  valType: xdrValue(specType('result', {
                    okType: xdrValue(specType('u32')),
                    errorType: xdrValue(specType('error')),
                  })),
                }),
              ]),
            })
          ),
        ]),
        outputs: xdrValue([]),
      }),
      specEntry('functionV0', {
        name: xdrValue('accept_unknown_type'),
        inputs: xdrValue([
          field('value', specType('udt', { name: xdrValue('FutureType') })),
        ]),
        outputs: xdrValue([]),
      }),
      specEntry('futureSpecEntryV0', {}),
    ]);

    expect(parsed.functions[0].inputs[0].type).toEqual({
      type: 'tuple',
      elements: [
        { type: 'vec', element: { type: 'string' } },
        {
          type: 'map',
          key: { type: 'symbol' },
          value: {
            type: 'result',
            ok: { type: 'u32' },
            error: { type: 'error' },
          },
        },
      ],
    });
    expect(
      parsed.functionSchemas.accept_unknown_type.properties.value
    ).toEqual({});
    expect(parsed.unsupportedEntries).toEqual(['futureSpecEntryV0']);
    expect(() => parseContractAbi(null)).toThrow(
      'Contract spec entries must be an array'
    );
  });
});
