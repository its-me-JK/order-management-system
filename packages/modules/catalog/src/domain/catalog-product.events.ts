import type { CatalogName } from './catalog-name';
import type {
  CatalogAggregateVersion,
  CatalogInstant,
  CatalogLifecycleReasonCode,
} from './catalog-values';
import type { CatalogProductId, CatalogProductStatus } from './catalog-product.values';

type CatalogProductEventFacts<
  EventType extends string,
  ResultingStatus extends CatalogProductStatus,
> = Readonly<{
  type: EventType;
  productId: CatalogProductId;
  name: CatalogName;
  status: ResultingStatus;
  version: CatalogAggregateVersion;
  occurredAt: CatalogInstant;
}>;

export type CatalogProductCreatedEvent = CatalogProductEventFacts<'PRODUCT_CREATED', 'DRAFT'>;

export type CatalogProductRenamedEvent = CatalogProductEventFacts<
  'PRODUCT_RENAMED',
  Exclude<CatalogProductStatus, 'ARCHIVED'>
> &
  Readonly<{
    previousName: CatalogName;
  }>;

export type CatalogProductActivatedEvent = CatalogProductEventFacts<'PRODUCT_ACTIVATED', 'ACTIVE'> &
  Readonly<{
    previousStatus: 'DRAFT';
  }>;

export type CatalogProductSuspendedEvent = CatalogProductEventFacts<
  'PRODUCT_SUSPENDED',
  'SUSPENDED'
> &
  Readonly<{
    previousStatus: 'ACTIVE';
    reasonCode: CatalogLifecycleReasonCode;
  }>;

export type CatalogProductResumedEvent = CatalogProductEventFacts<'PRODUCT_RESUMED', 'ACTIVE'> &
  Readonly<{
    previousStatus: 'SUSPENDED';
  }>;

export type CatalogProductArchivedEvent = CatalogProductEventFacts<'PRODUCT_ARCHIVED', 'ARCHIVED'> &
  Readonly<{
    previousStatus: Exclude<CatalogProductStatus, 'ARCHIVED'>;
    reasonCode: CatalogLifecycleReasonCode;
  }>;

export type CatalogProductDomainEvent =
  | CatalogProductCreatedEvent
  | CatalogProductRenamedEvent
  | CatalogProductActivatedEvent
  | CatalogProductSuspendedEvent
  | CatalogProductResumedEvent
  | CatalogProductArchivedEvent;

export type CatalogProductMutationEvent = Exclude<
  CatalogProductDomainEvent,
  CatalogProductCreatedEvent
>;
