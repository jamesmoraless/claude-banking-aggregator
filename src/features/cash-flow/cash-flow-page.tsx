import { RouteNotImplemented } from '@/components/common/not-implemented';

export function CashFlowPage() {
  return (
    <RouteNotImplemented
      title="Cash Flow"
      description="What you actually earned and spent, and how the figures were derived."
      plannedWork={[
        'Range presets, income vs spending chart and spending breakdown',
        'Excluded-from-spending panel and the full monthly calculation summary',
        'Click any figure to inspect the transactions behind it',
      ]}
    />
  );
}
