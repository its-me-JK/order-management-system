import path from 'node:path';

const BUSINESS_MODULE_SOURCE_ROOT = /^(.*\/packages\/modules\/[^/]+\/src)(?:\/|$)/;
const BUSINESS_INFRASTRUCTURE_ALIAS = /^@oms\/[^/]+\/(?:src\/)?infrastructure(?:\/|$)/;
const BUSINESS_INFRASTRUCTURE_PATH =
  /(?:^|\/)packages\/modules\/[^/]+\/src\/infrastructure(?:\/|$)/;

const normalizePath = (value) => value.replaceAll('\\', '/');

const isRelativeSpecifier = (specifier) =>
  specifier === '.' ||
  specifier === '..' ||
  specifier.startsWith('./') ||
  specifier.startsWith('../');

const isWithin = (candidate, directory) => {
  const relative = path.relative(directory, candidate);

  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

const findBusinessModuleSourceRoot = (filename) => {
  const match = BUSINESS_MODULE_SOURCE_ROOT.exec(normalizePath(path.resolve(filename)));

  return match?.[1] ? path.normalize(match[1]) : null;
};

const literalSpecifier = (node) =>
  node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;

const layerMessageId = {
  application: 'applicationBoundary',
  'api-feature': 'apiFeatureBoundary',
  domain: 'domainBoundary',
};

const enforceLayerImports = {
  create(context) {
    const [{ layer }] = context.options;
    const filename = context.filename ?? context.getFilename();
    const moduleSourceRoot = findBusinessModuleSourceRoot(filename);

    const report = (node) => {
      context.report({ messageId: layerMessageId[layer], node });
    };

    const validateDomainOrApplicationImport = (node, specifier) => {
      if (!specifier || !isRelativeSpecifier(specifier) || !moduleSourceRoot) {
        report(node);
        return;
      }

      const target = path.resolve(path.dirname(filename), specifier);
      const allowedDirectories =
        layer === 'domain'
          ? [path.join(moduleSourceRoot, 'domain')]
          : [path.join(moduleSourceRoot, 'application'), path.join(moduleSourceRoot, 'domain')];

      if (!allowedDirectories.some((directory) => isWithin(target, directory))) {
        report(node);
      }
    };

    const validateApiFeatureImport = (node, specifier) => {
      if (!specifier) {
        report(node);
        return;
      }

      if (BUSINESS_INFRASTRUCTURE_ALIAS.test(specifier)) {
        report(node);
        return;
      }

      const candidate = isRelativeSpecifier(specifier)
        ? normalizePath(path.resolve(path.dirname(filename), specifier))
        : normalizePath(specifier);

      if (BUSINESS_INFRASTRUCTURE_PATH.test(candidate)) {
        report(node);
      }
    };

    const validate = (node, sourceNode) => {
      const specifier = literalSpecifier(sourceNode);

      if (layer === 'api-feature') {
        validateApiFeatureImport(node, specifier);
        return;
      }

      validateDomainOrApplicationImport(node, specifier);
    };

    return {
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          validate(node, node.arguments[0]);
        }
      },
      ExportAllDeclaration(node) {
        validate(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          validate(node, node.source);
        }
      },
      ImportDeclaration(node) {
        validate(node, node.source);
      },
      ImportExpression(node) {
        validate(node, node.source);
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === 'TSExternalModuleReference') {
          validate(node, node.moduleReference.expression);
        }
      },
      TSImportType(node) {
        validate(node, node.source);
      },
    };
  },
  meta: {
    docs: {
      description: 'Enforce inward-only Clean Architecture imports by resolved source layer.',
    },
    messages: {
      applicationBoundary:
        'Application code may import only its own application and domain layers. Depend on application-owned ports; wire every vendor and infrastructure concern outside the application.',
      apiFeatureBoundary:
        'API feature delivery code cannot import a business module infrastructure adapter. Wire adapters only in the API composition root.',
      domainBoundary:
        'Domain code may import only its own domain layer. Move framework, vendor, application, and infrastructure concerns behind an outer-layer port.',
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          layer: {
            enum: ['application', 'api-feature', 'domain'],
          },
        },
        required: ['layer'],
        type: 'object',
      },
    ],
    type: 'problem',
  },
};

export default {
  rules: {
    'enforce-layer-imports': enforceLayerImports,
  },
};
