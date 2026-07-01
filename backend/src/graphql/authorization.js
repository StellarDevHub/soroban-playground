import { createSchema } from 'graphql-yoga';
import { GraphQLError } from 'graphql';

function parseDirectiveValue(valueNode) {
  if (!valueNode) return null;

  switch (valueNode.kind) {
    case 'StringValue':
      return valueNode.value;
    case 'BooleanValue':
      return valueNode.value;
    case 'IntValue':
      return Number.parseInt(valueNode.value, 10);
    case 'FloatValue':
      return Number.parseFloat(valueNode.value);
    case 'ListValue':
      return valueNode.values.map(parseDirectiveValue);
    case 'EnumValue':
      return valueNode.value;
    default:
      return null;
  }
}

function getDirectiveValue(directiveNode, name) {
  const argument = directiveNode.arguments?.find((arg) => arg.name.value === name);
  return argument ? parseDirectiveValue(argument.value) : null;
}

function buildUserContext(context) {
  const rawUser = context?.user ?? context?.jwt ?? context?.auth?.user ?? {};
  const roles = Array.isArray(rawUser.roles)
    ? rawUser.roles.filter(Boolean)
    : rawUser.role
      ? [rawUser.role]
      : [];

  return {
    ...rawUser,
    roles: roles.length > 0 ? roles : ['guest'],
  };
}

function hasRequiredRole(user, role) {
  return user?.roles?.includes(role);
}

function evaluateDirective(node, user) {
  const directiveName = node.name?.value;

  if (directiveName === 'auth') {
    const requires = getDirectiveValue(node, 'requires') ?? ['authenticated'];
    if (!Array.isArray(requires)) {
      return null;
    }

    const isAuthenticated = Boolean(
      user &&
        (user.id || user.sub || user.email || user.roles?.length || user.role)
    );

    if (!isAuthenticated) {
      return new GraphQLError('Authentication required.', {
        extensions: { code: 'FORBIDDEN' },
      });
    }

    const missingRole = requires.find(
      (requirement) => requirement !== 'authenticated' && !hasRequiredRole(user, requirement)
    );

    if (missingRole) {
      return new GraphQLError(`Unauthorized: requires role "${missingRole}".`, {
        extensions: { code: 'FORBIDDEN' },
      });
    }

    return null;
  }

  if (directiveName === 'hasRole') {
    const role = getDirectiveValue(node, 'role');
    if (!role) {
      return null;
    }

    if (!hasRequiredRole(user, role)) {
      return new GraphQLError(`Unauthorized: requires role "${role}".`, {
        extensions: { code: 'FORBIDDEN' },
      });
    }

    return null;
  }

  return null;
}

function collectDirectives(info) {
  const fieldDefinition = info.parentType?.getFields?.()[info.fieldName];
  const directives = [];

  if (fieldDefinition?.astNode?.directives) {
    directives.push(...fieldDefinition.astNode.directives);
  }

  if (info.parentType?.astNode?.directives) {
    directives.push(...info.parentType.astNode.directives);
  }

  return directives;
}

function authorizeField(info, context) {
  const directives = collectDirectives(info);
  if (!directives.length) {
    return null;
  }

  const user = buildUserContext(context);

  for (const directive of directives) {
    const error = evaluateDirective(directive, user);
    if (error) {
      return error;
    }
  }

  return null;
}

function wrapResolver(resolver) {
  if (typeof resolver !== 'function') {
    return resolver;
  }

  return function wrappedResolver(source, args, context, info) {
    const authError = authorizeField(info, context);
    if (authError) {
      throw authError;
    }

    return resolver(source, args, context, info);
  };
}

function wrapResolvers(value) {
  if (typeof value === 'function') {
    return wrapResolver(value);
  }

  if (Array.isArray(value)) {
    return value.map(wrapResolvers);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        wrapResolvers(nestedValue),
      ])
    );
  }

  return value;
}

export function buildGraphQLSchema({ typeDefs, resolvers }) {
  return createSchema({
    typeDefs,
    resolvers: wrapResolvers(resolvers),
  });
}
