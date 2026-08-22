export type PublicSkuProductSummary = Readonly<{
  id: string;
  name: string;
}>;

/**
 * The catalog projection that may cross a public delivery boundary.
 *
 * Lifecycle state and persistence metadata are deliberately absent. A
 * repository may return this projection only when both the SKU and its
 * Product are active.
 */
export type PublicSku = Readonly<{
  code: string;
  id: string;
  name: string;
  product: PublicSkuProductSummary;
}>;
