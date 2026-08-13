import { RouteNotImplemented } from '@/components/common/not-implemented';

export function TransactionsPage() {
  return (
    <RouteNotImplemented
      title="Transactions"
      description="Search, filter and reclassify every transaction."
      plannedWork={[
        'Date range, account, institution, category, classification and amount filters',
        'Detail drawer with reclassification and transfer-match inspection',
        'Reusable classification rules created from a transaction',
      ]}
    />
  );
}
