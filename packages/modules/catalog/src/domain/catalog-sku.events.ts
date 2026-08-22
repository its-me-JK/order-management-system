import type { CatalogName } from './catalog-name';
import type { CatalogProductId } from './catalog-product.values';
import type { CatalogSkuCode, CatalogSkuId, CatalogSkuStatus } from './catalog-sku.values';
import type {
  CatalogAggregateVersion,
  CatalogInstant,
  CatalogLifecycleReasonCode,
} from './catalog-values';

type CatalogSkuEventFacts<
  EventType extends string,
  ResultingStatus extends CatalogSkuStatus,
> = Readonly<{
  type: EventType;
  skuId: CatalogSkuId;
  productId: CatalogProductId;
  code: CatalogSkuCode;
  name: CatalogName;
  status: ResultingStatus;
  version: CatalogAggregateVersion;
  occurredAt: CatalogInstant;
}>;

export type CatalogSkuCreatedEvent = CatalogSkuEventFacts<'SKU_CREATED', 'DRAFT'>;

export type CatalogSkuRenamedEvent = CatalogSkuEventFacts<
  'SKU_RENAMED',
  Exclude<CatalogSkuStatus, 'RETIRED'>
> &
  Readonly<{
    previousName: CatalogName;
  }>;

export type CatalogSkuActivatedEvent = CatalogSkuEventFacts<'SKU_ACTIVATED', 'ACTIVE'> &
  Readonly<{
    previousStatus: 'DRAFT';
  }>;

export type CatalogSkuSuspendedEvent = CatalogSkuEventFacts<'SKU_SUSPENDED', 'SUSPENDED'> &
  Readonly<{
    previousStatus: 'ACTIVE';
    reasonCode: CatalogLifecycleReasonCode;
  }>;

export type CatalogSkuResumedEvent = CatalogSkuEventFacts<'SKU_RESUMED', 'ACTIVE'> &
  Readonly<{
    previousStatus: 'SUSPENDED';
  }>;

export type CatalogSkuRetiredEvent = CatalogSkuEventFacts<'SKU_RETIRED', 'RETIRED'> &
  Readonly<{
    previousStatus: Exclude<CatalogSkuStatus, 'RETIRED'>;
    reasonCode: CatalogLifecycleReasonCode;
  }>;

export type CatalogSkuDomainEvent =
  | CatalogSkuCreatedEvent
  | CatalogSkuRenamedEvent
  | CatalogSkuActivatedEvent
  | CatalogSkuSuspendedEvent
  | CatalogSkuResumedEvent
  | CatalogSkuRetiredEvent;

export type CatalogSkuMutationEvent = Exclude<CatalogSkuDomainEvent, CatalogSkuCreatedEvent>;
