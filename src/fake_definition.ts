import {
  Kind,
  Source,
  DocumentNode,
  GraphQLError,
  GraphQLSchema,
  parse,
  validate,
  extendSchema,
  buildASTSchema,
  validateSchema,
  isObjectType,
  isInterfaceType,
  ValuesOfCorrectTypeRule,
} from 'graphql';

// FIXME
import { validateSDL } from 'graphql/validation/validate';
import schema from './schema';

const fakeDefinitionAST = parse(schema);

function defToName(defNode) {
  const { kind, name } = defNode;
  if (name == null) {
    return '';
  }
  return (kind === Kind.DIRECTIVE_DEFINITION ? '@' : '') + name.value;
}

const fakeDefinitionsSet = new Set(
  fakeDefinitionAST.definitions.map(defToName),
);

const schemaWithOnlyFakedDefinitions = buildASTSchema(fakeDefinitionAST);
// FIXME: mark it as valid to be able to run `validate`
schemaWithOnlyFakedDefinitions['__validationErrors'] = [];

export function buildWithFakeDefinitions(
  schemaSDL: Source,
  extensionSDL?: Source,
  options?: { skipValidation: boolean },
): GraphQLSchema {
  const skipValidation = options?.skipValidation ?? false;
  const schemaAST = parseSDL(schemaSDL);

  // Remove Faker's own definitions that were added to have valid SDL for other
  // tools, see: https://github.com/APIs-guru/graphql-faker/issues/75
  const filteredAST = {
    ...schemaAST,
    definitions: schemaAST.definitions.filter((def) => {
      const name = defToName(def);
      return name === '' || !fakeDefinitionsSet.has(name);
    }),
  };

  let schema = extendSchemaWithAST(schemaWithOnlyFakedDefinitions, filteredAST);

  const config = schema.toConfig();
  schema = new GraphQLSchema({
    ...config,
    ...(config.astNode ? {} : getDefaultRootTypes(schema)),
  });

  if (extensionSDL != null) {
    schema = extendSchemaWithAST(schema, parseSDL(extensionSDL));

    for (const type of Object.values(schema.getTypeMap())) {
      if (isObjectType(type) || isInterfaceType(type)) {
        for (const field of Object.values(type.getFields())) {
          const isExtensionField = field.astNode?.loc?.source === extensionSDL;
          if (field.extensions) {
            (field.extensions as any)['isExtensionField'] = isExtensionField;
          } else {
            field.extensions = { isExtensionField };
          }
        }
      }
    }
  }

  if (!skipValidation) {
    const errors = validateSchema(schema);
    if (errors.length !== 0) {
      throw new ValidationErrors(errors);
    }
  }

  return schema;

  function extendSchemaWithAST(
    schema: GraphQLSchema,
    extensionAST: DocumentNode,
  ): GraphQLSchema {
    if (!skipValidation) {
      const errors = [
        ...validateSDL(extensionAST, schema),
        ...validate(schemaWithOnlyFakedDefinitions, extensionAST, [
          ValuesOfCorrectTypeRule,
        ]),
      ];
      if (errors.length !== 0) {
        throw new ValidationErrors(errors);
      }
    }

    return extendSchema(schema, extensionAST, {
      assumeValid: true,
      commentDescriptions: true,
    });
  }
}

// FIXME: move to 'graphql-js'
export class ValidationErrors extends Error {
  subErrors: GraphQLError[];

  constructor(errors) {
    const message = errors.map((error) => error.message).join('\n\n');
    super(message);

    this.subErrors = errors;
    this.name = this.constructor.name;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

function getDefaultRootTypes(schema) {
  return {
    query: schema.getType('Query'),
    mutation: schema.getType('Mutation'),
    subscription: schema.getType('Subscription'),
  };
}

function parseSDL(sdl: Source) {
  return parse(sdl, {
    allowLegacySDLEmptyFields: true,
    allowLegacySDLImplementsInterfaces: true,
  });
}
