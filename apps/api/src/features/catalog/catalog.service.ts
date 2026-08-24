import { randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@oms/database/prisma';

import { DATABASE_CLIENT } from '../../platform/database/database.tokens';
import type {
  CatalogCollectionQueryDto,
  CatalogStatus,
  CreateProductDto,
  CreateSkuDto,
  SkuCollectionQueryDto,
  UpdateProductDto,
  UpdateSkuDto,
} from './catalog.dto';
import { mapProduct, mapSku, type ProductResponse, type SkuResponse } from './catalog.responses';

const DEFAULT_LIMIT = 50;

function parseLimit(value: string | undefined): number {
  return value === undefined ? DEFAULT_LIMIT : Number(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'P2002';
}

function productUpdateData(input: UpdateProductDto): {
  name?: string;
  description?: string;
  status?: CatalogStatus;
  version: { increment: number };
} {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.status === undefined ? {} : { status: input.status }),
    version: { increment: 1 },
  };
}

function skuUpdateData(input: UpdateSkuDto): {
  name?: string;
  price?: Prisma.Decimal;
  currency?: string;
  status?: CatalogStatus;
  version: { increment: number };
} {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.price === undefined ? {} : { price: new Prisma.Decimal(input.price) }),
    ...(input.currency === undefined ? {} : { currency: input.currency }),
    ...(input.status === undefined ? {} : { status: input.status }),
    version: { increment: 1 },
  };
}

@Injectable()
export class CatalogService {
  public constructor(
    @Inject(DATABASE_CLIENT)
    private readonly prisma: PrismaClient,
  ) {}

  public async listProducts(query: CatalogCollectionQueryDto): Promise<readonly ProductResponse[]> {
    const records = await this.prisma.productRecord.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: parseLimit(query.limit),
    });

    return records.map(mapProduct);
  }

  public async listSkus(query: SkuCollectionQueryDto): Promise<readonly SkuResponse[]> {
    const records = await this.prisma.skuRecord.findMany({
      where: {
        status: 'ACTIVE',
        product: { status: 'ACTIVE' },
        ...(query.productId === undefined ? {} : { productId: query.productId }),
      },
      include: {
        product: { select: { id: true, name: true, description: true } },
        inventory: { select: { available: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: parseLimit(query.limit),
    });

    return records.map(mapSku);
  }

  public async getSku(id: string): Promise<SkuResponse> {
    const record = await this.prisma.skuRecord.findFirst({
      where: { id, status: 'ACTIVE', product: { status: 'ACTIVE' } },
      include: {
        product: { select: { id: true, name: true, description: true } },
        inventory: { select: { available: true } },
      },
    });

    if (record === null) throw new NotFoundException();
    return mapSku(record);
  }

  public async createProduct(input: CreateProductDto): Promise<ProductResponse> {
    const record = await this.prisma.productRecord.create({
      data: {
        id: randomUUID(),
        name: input.name,
        description: input.description,
        status: input.status ?? 'DRAFT',
      },
    });

    return mapProduct(record);
  }

  public async updateProduct(id: string, input: UpdateProductDto): Promise<ProductResponse> {
    const result = await this.prisma.productRecord.updateMany({
      where: { id, version: input.version },
      data: productUpdateData(input),
    });

    if (result.count !== 1) {
      const exists = await this.prisma.productRecord.findUnique({
        where: { id },
        select: { id: true },
      });

      if (exists === null) throw new NotFoundException();
      throw new ConflictException();
    }

    const record = await this.prisma.productRecord.findUnique({ where: { id } });

    if (record === null) throw new NotFoundException();
    return mapProduct(record);
  }

  public async createSku(productId: string, input: CreateSkuDto): Promise<SkuResponse> {
    const product = await this.prisma.productRecord.findUnique({ where: { id: productId } });

    if (product === null) throw new NotFoundException();
    if (
      product.status === 'ARCHIVED' ||
      (input.status === 'ACTIVE' && product.status !== 'ACTIVE')
    ) {
      throw new ConflictException();
    }

    try {
      const record = await this.prisma.skuRecord.create({
        data: {
          id: randomUUID(),
          productId: product.id,
          code: input.code,
          name: input.name,
          price: new Prisma.Decimal(input.price),
          currency: input.currency,
          status: input.status ?? 'DRAFT',
        },
        include: {
          product: { select: { id: true, name: true, description: true } },
          inventory: { select: { available: true } },
        },
      });

      return mapSku(record);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw new ConflictException();
      throw error;
    }
  }

  public async updateSku(id: string, input: UpdateSkuDto): Promise<SkuResponse> {
    const existing = await this.prisma.skuRecord.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true, description: true, status: true } },
      },
    });

    if (existing === null) throw new NotFoundException();
    if (input.status === 'ACTIVE' && existing.product.status !== 'ACTIVE') {
      throw new ConflictException();
    }

    const result = await this.prisma.skuRecord.updateMany({
      where: { id, version: input.version },
      data: skuUpdateData(input),
    });

    if (result.count !== 1) throw new ConflictException();

    const record = await this.prisma.skuRecord.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true, description: true } },
        inventory: { select: { available: true } },
      },
    });

    if (record === null) throw new NotFoundException();
    return mapSku(record);
  }
}
