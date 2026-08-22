import type { NextFunction, Request, Response } from 'express';
import { NotFoundException } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
  type OperationObject,
  type PathItemObject,
} from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { ApiModule } from './api.module';
import { CATALOG_PUBLIC_SKU_OPENAPI_SCHEMAS } from './features/catalog/delivery/http/catalog-public-sku.openapi.schemas';
import { OPENAPI_HEADERS, OPENAPI_SCHEMAS } from './platform/openapi/openapi.schemas';

export const API_DOCUMENTATION_PATH = '/docs';
export const OPENAPI_JSON_PATH = '/docs/openapi.json';

const UNSPECIFIED_OPERATION_PREFIX = 'UNSPECIFIED_';
const OPERATION_ID = /^[a-z][A-Za-z0-9]*$/u;
const DOCUMENTATION_RESOURCE_PATHS = new Set([
  '/',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/openapi.json',
  '/swagger-ui-bundle.js',
  '/swagger-ui-init.js',
  '/swagger-ui-standalone-preset.js',
  '/swagger-ui.css',
]);
const HTTP_OPERATION_KEYS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const satisfies readonly (keyof PathItemObject)[];

function documentationSurfacePolicy(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader('Cache-Control', 'no-store');

  if (DOCUMENTATION_RESOURCE_PATHS.has(request.path)) {
    next();
    return;
  }

  next(new NotFoundException());
}

function operationIdFallback(controllerKey: string, methodKey: string, version?: string): string {
  return `${UNSPECIFIED_OPERATION_PREFIX}${controllerKey}_${methodKey}_${version ?? 'neutral'}`;
}

function operations(document: OpenAPIObject): readonly OperationObject[] {
  const result: OperationObject[] = [];

  for (const pathItem of Object.values(document.paths)) {
    for (const operationKey of HTTP_OPERATION_KEYS) {
      const operation = pathItem[operationKey];

      if (operation !== undefined) {
        result.push(operation);
      }
    }
  }

  return result;
}

export function assertValidOperationIds(document: OpenAPIObject): void {
  const operationIds = operations(document).map((operation) => operation.operationId);

  if (
    operationIds.some(
      (operationId): boolean =>
        operationId === undefined ||
        operationId.startsWith(UNSPECIFIED_OPERATION_PREFIX) ||
        !OPERATION_ID.test(operationId),
    ) ||
    new Set(operationIds).size !== operationIds.length
  ) {
    throw new Error('The generated OpenAPI document has invalid operation identifiers');
  }
}

export function createApiDocument(application: NestExpressApplication): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setOpenAPIVersion('3.0.3')
    .setTitle('Order Management System API')
    .setDescription(
      'Versioned order-management HTTP contracts and unversioned operational health endpoints.',
    )
    .setVersion('1.0.0')
    .setLicense('MIT', 'https://opensource.org/license/mit')
    .addTag(
      'Catalog',
      'Anonymous public Product and SKU discovery without price or availability claims.',
    )
    .addTag(
      'Operational Health',
      'Sanitized liveness and readiness contracts for deployment automation.',
    )
    .build();

  configuration.components = {
    ...configuration.components,
    headers: { ...OPENAPI_HEADERS },
    schemas: { ...OPENAPI_SCHEMAS, ...CATALOG_PUBLIC_SKU_OPENAPI_SCHEMAS },
  };

  const document = SwaggerModule.createDocument(application, configuration, {
    autoTagControllers: false,
    deepScanRoutes: true,
    ignoreGlobalPrefix: false,
    include: [ApiModule],
    operationIdFactory: operationIdFallback,
  });

  assertValidOperationIds(document);

  return document;
}

export function configureApiDocumentation(application: NestExpressApplication): void {
  application.use(API_DOCUMENTATION_PATH, documentationSurfacePolicy);

  SwaggerModule.setup(API_DOCUMENTATION_PATH, application, createApiDocument(application), {
    customSiteTitle: 'OMS API Documentation',
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    raw: ['json'],
    swaggerOptions: {
      displayRequestDuration: true,
      persistAuthorization: false,
      queryConfigEnabled: false,
      supportedSubmitMethods: [],
      tryItOutEnabled: false,
      validatorUrl: null,
    },
    ui: true,
    useGlobalPrefix: false,
  });
}
