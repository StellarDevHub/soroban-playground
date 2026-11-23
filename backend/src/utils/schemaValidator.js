// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Lightweight schema validation engine.
 * Supports type coercion, strict mode, and standardized error output.
 */

class ValidationError extends Error {
  constructor(errors) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

class SchemaField {
  constructor() {
    this._required = false;
    this._coerce = false;
    this._type = null;
    this._rules = [];
    this._defaultValue = undefined;
  }

  required(msg) {
    this._required = true;
    this._requiredMsg = msg;
    return this;
  }

  optional() {
    this._required = false;
    return this;
  }

  coerce() {
    this._coerce = true;
    return this;
  }

  default(value) {
    this._defaultValue = value;
    return this;
  }

  _addRule(fn) {
    this._rules.push(fn);
    return this;
  }

  _validate(value, path) {
    const errors = [];

    if (value === undefined || value === null || value === '') {
      if (this._defaultValue !== undefined)
        return { value: this._defaultValue, errors: [] };
      if (this._required) {
        return {
          value,
          errors: [
            { path, message: this._requiredMsg || `${path} is required` },
          ],
        };
      }
      return { value, errors: [] };
    }

    let coerced = value;
    if (this._coerce && this._type) {
      coerced = this._coerceValue(value, path, errors);
      if (errors.length) return { value, errors };
    } else if (this._type && !this._checkType(value)) {
      return {
        value,
        errors: [{ path, message: `${path} must be of type ${this._type}` }],
      };
    }

    for (const rule of this._rules) {
      const err = rule(coerced, path);
      if (err) errors.push(err);
    }

    return { value: coerced, errors };
  }

  _checkType(value) {
    if (this._type === 'string') return typeof value === 'string';
    if (this._type === 'number')
      return typeof value === 'number' && !isNaN(value);
    if (this._type === 'boolean') return typeof value === 'boolean';
    if (this._type === 'array') return Array.isArray(value);
    if (this._type === 'object')
      return (
        value !== null && typeof value === 'object' && !Array.isArray(value)
      );
    return true;
  }

  _coerceValue(value, path, errors) {
    try {
      if (this._type === 'number') {
        const n = Number(value);
        if (isNaN(n)) throw new Error();
        return n;
      }
      if (this._type === 'boolean') {
        if (value === 'true' || value === true || value === 1) return true;
        if (value === 'false' || value === false || value === 0) return false;
        throw new Error();
      }
      if (this._type === 'string') return String(value);
    } catch {
      errors.push({
        path,
        message: `${path} cannot be coerced to ${this._type}`,
      });
    }
    return value;
  }
}

class StringField extends SchemaField {
  constructor() {
    super();
    this._type = 'string';
  }

  min(n, msg) {
    return this._addRule((v, path) =>
      v.length < n
        ? { path, message: msg || `${path} must be at least ${n} characters` }
        : null
    );
  }

  max(n, msg) {
    return this._addRule((v, path) =>
      v.length > n
        ? { path, message: msg || `${path} must be at most ${n} characters` }
        : null
    );
  }

  email(msg) {
    return this._addRule((v, path) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
        ? null
        : { path, message: msg || `${path} must be a valid email` }
    );
  }

  pattern(regex, msg) {
    return this._addRule((v, path) =>
      regex.test(v)
        ? null
        : { path, message: msg || `${path} has an invalid format` }
    );
  }

  oneOf(values, msg) {
    return this._addRule((v, path) =>
      values.includes(v)
        ? null
        : {
            path,
            message: msg || `${path} must be one of: ${values.join(', ')}`,
          }
    );
  }
}

class NumberField extends SchemaField {
  constructor() {
    super();
    this._type = 'number';
  }

  min(n, msg) {
    return this._addRule((v, path) =>
      v < n ? { path, message: msg || `${path} must be >= ${n}` } : null
    );
  }

  max(n, msg) {
    return this._addRule((v, path) =>
      v > n ? { path, message: msg || `${path} must be <= ${n}` } : null
    );
  }

  integer(msg) {
    return this._addRule((v, path) =>
      Number.isInteger(v)
        ? null
        : { path, message: msg || `${path} must be an integer` }
    );
  }
}

class BooleanField extends SchemaField {
  constructor() {
    super();
    this._type = 'boolean';
  }
}

class ArrayField extends SchemaField {
  constructor(itemSchema) {
    super();
    this._type = 'array';
    this._itemSchema = itemSchema;
  }

  min(n, msg) {
    return this._addRule((v, path) =>
      v.length < n
        ? {
            path,
            message:
              msg ||
              `${path} must contain at least ${n} item${n === 1 ? '' : 's'}`,
          }
        : null
    );
  }

  max(n, msg) {
    return this._addRule((v, path) =>
      v.length > n
        ? {
            path,
            message:
              msg ||
              `${path} must contain at most ${n} item${n === 1 ? '' : 's'}`,
          }
        : null
    );
  }

  _validate(value, path) {
    const result = super._validate(value, path);
    if (!Array.isArray(result.value) || !this._itemSchema) return result;

    const errors = [...result.errors];
    const items = result.value.map((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (typeof this._itemSchema._validate === 'function') {
        const validated = this._itemSchema._validate(item, itemPath);
        errors.push(...validated.errors);
        return validated.value;
      }

      const validated = this._itemSchema.validate(item);
      errors.push(
        ...validated.errors.map((error) => ({
          ...error,
          path: error.path === 'body' ? itemPath : `${itemPath}.${error.path}`,
        }))
      );
      return validated.value;
    });

    return { value: items, errors };
  }
}

class ObjectSchema extends SchemaField {
  constructor(shape, options = {}) {
    super();
    this._type = 'object';
    this._shape = shape || {};
    this._strict = shape === undefined ? false : options.strict !== false;
    this._passthrough = shape === undefined;
  }

  _validate(data, path) {
    const result = super._validate(data, path);
    if (
      result.errors.length ||
      result.value === undefined ||
      result.value === null ||
      this._passthrough
    ) {
      return result;
    }

    return this._validateShape(result.value, path);
  }

  _validateShape(data, path) {
    const errors = [];
    const output = {};

    if (this._strict) {
      const declared = new Set(Object.keys(this._shape));
      for (const key of Object.keys(data)) {
        if (!declared.has(key)) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Unknown field: ${key}`,
          });
        }
      }
    }

    for (const [key, field] of Object.entries(this._shape)) {
      const fieldPath = path ? `${path}.${key}` : key;
      const { value, errors: fieldErrors } = field._validate(
        data[key],
        fieldPath
      );
      if (fieldErrors.length) {
        errors.push(...fieldErrors);
      } else if (value !== undefined) {
        output[key] = value;
      }
    }

    return { value: this._passthrough ? data : output, errors };
  }

  /**
   * Validate data against the schema.
   * @param {object} data
   * @returns {{ value: object, errors: Array<{path: string, message: string}> }}
   */
  validate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        value: data,
        errors: [{ path: 'body', message: 'Expected an object' }],
      };
    }

    return this._validateShape(data, '');
  }

  /**
   * Parse and throw on validation failure.
   * @param {object} data
   * @returns {object}
   */
  parse(data) {
    const { value, errors } = this.validate(data);
    if (errors.length) throw new ValidationError(errors);
    return value;
  }
}

export const v = {
  string: () => new StringField(),
  number: () => new NumberField(),
  boolean: () => new BooleanField(),
  array: (itemSchema) => new ArrayField(itemSchema),
  object: (shape, options) => new ObjectSchema(shape, options),
};

export { ValidationError };
