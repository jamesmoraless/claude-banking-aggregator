import { Search, SlidersHorizontal, X } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAccounts, useInstitutions } from '@/features/accounts/hooks';
import { ECONOMIC_TYPE_LABELS, ECONOMIC_TYPES } from '@/lib/financial/classification';
import { RANGE_PRESETS, resolveRangePreset } from '@/lib/financial/dates';

import type { TransactionFilters } from './api';
import { useAvailableCategories } from './hooks';

/**
 * Transaction filters.
 *
 * The search box is debounced so that typing does not fire a query per
 * keystroke; every other control applies immediately, because a filter that
 * needs an "Apply" click makes exploration feel heavy.
 */
export function TransactionFilterBar({
  filters,
  onChange,
  onClear,
  hasActiveFilters,
}: {
  filters: TransactionFilters;
  onChange: (filters: TransactionFilters) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
}) {
  const accounts = useAccounts();
  const institutions = useInstitutions();
  const categories = useAvailableCategories();

  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState(filters.search ?? '');

  // Keep the input in step with external changes (a cleared filter, a link).
  React.useEffect(() => {
    setSearchValue(filters.search ?? '');
  }, [filters.search]);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if ((filters.search ?? '') !== searchValue) {
        onChange({ ...filters, search: searchValue });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue, filters, onChange]);

  const update = (partial: Partial<TransactionFilters>) => onChange({ ...filters, ...partial });

  const activeCount = countActiveFilters(filters);

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search merchant or description…"
              aria-label="Search transactions"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-input p-0.5" role="group" aria-label="Date range">
              {RANGE_PRESETS.map((preset) => {
                const range = resolveRangePreset(preset.id);
                const isActive = filters.from === range.from && filters.to === range.to;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => update({ from: range.from, to: range.to })}
                    className={
                      isActive
                        ? 'rounded-md bg-primary-subtle px-3 py-1 text-sm font-medium text-primary'
                        : 'rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    }
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdvanced((value) => !value)}
              aria-expanded={showAdvanced}
            >
              <SlidersHorizontal aria-hidden="true" />
              Filters
              {activeCount > 0 ? (
                <Badge variant="default" className="ml-1">
                  {activeCount}
                </Badge>
              ) : null}
            </Button>

            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={onClear}>
                <X aria-hidden="true" />
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {showAdvanced ? (
          <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-4">
            <FilterField label="From" htmlFor="filter-from">
              <Input
                id="filter-from"
                type="date"
                value={filters.from ?? ''}
                onChange={(event) => update({ from: event.target.value })}
              />
            </FilterField>

            <FilterField label="To" htmlFor="filter-to">
              <Input
                id="filter-to"
                type="date"
                value={filters.to ?? ''}
                onChange={(event) => update({ to: event.target.value })}
              />
            </FilterField>

            <FilterField label="Account" htmlFor="filter-account">
              <Select
                value={filters.accountIds?.[0] ?? 'all'}
                onValueChange={(value) =>
                  update({ accountIds: value === 'all' ? undefined : [value] })
                }
              >
                <SelectTrigger id="filter-account">
                  <SelectValue placeholder="All accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {(accounts.data ?? []).map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.effective_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Institution" htmlFor="filter-institution">
              <Select
                value={filters.institutionIds?.[0] ?? 'all'}
                onValueChange={(value) =>
                  update({ institutionIds: value === 'all' ? undefined : [value] })
                }
              >
                <SelectTrigger id="filter-institution">
                  <SelectValue placeholder="All institutions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All institutions</SelectItem>
                  {(institutions.data ?? []).map((institution) => (
                    <SelectItem key={institution.id} value={institution.id}>
                      {institution.display_name ?? institution.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Category" htmlFor="filter-category">
              <Select
                value={filters.categories?.[0] ?? 'all'}
                onValueChange={(value) =>
                  update({ categories: value === 'all' ? undefined : [value] })
                }
              >
                <SelectTrigger id="filter-category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {(categories.data ?? []).map((category) => (
                    <SelectItem key={category} value={category}>
                      {category.replace(/_/g, ' ').toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Classification" htmlFor="filter-type">
              <Select
                value={filters.economicTypes?.[0] ?? 'all'}
                onValueChange={(value) =>
                  update({
                    economicTypes:
                      value === 'all'
                        ? undefined
                        : [value as NonNullable<TransactionFilters['economicTypes']>[number]],
                  })
                }
              >
                <SelectTrigger id="filter-type">
                  <SelectValue placeholder="All classifications" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All classifications</SelectItem>
                  {ECONOMIC_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {ECONOMIC_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Status" htmlFor="filter-status">
              <Select
                value={filters.status ?? 'ALL'}
                onValueChange={(value) =>
                  update({ status: value as TransactionFilters['status'] })
                }
              >
                <SelectTrigger id="filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Posted and pending</SelectItem>
                  <SelectItem value="POSTED">Posted only</SelectItem>
                  <SelectItem value="PENDING">Pending only</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Transfers" htmlFor="filter-transfers">
              <Select
                value={filters.transferStatus ?? 'ALL'}
                onValueChange={(value) =>
                  update({ transferStatus: value as TransactionFilters['transferStatus'] })
                }
              >
                <SelectTrigger id="filter-transfers">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Include transfers</SelectItem>
                  <SelectItem value="EXCLUDING_TRANSFERS">Exclude transfers</SelectItem>
                  <SelectItem value="TRANSFERS_ONLY">Transfers only</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Minimum amount" htmlFor="filter-min">
              <Input
                id="filter-min"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={filters.minAmount ?? ''}
                onChange={(event) =>
                  update({
                    minAmount: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
              />
            </FilterField>

            <FilterField label="Maximum amount" htmlFor="filter-max">
              <Input
                id="filter-max"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="No limit"
                value={filters.maxAmount ?? ''}
                onChange={(event) =>
                  update({
                    maxAmount: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
              />
            </FilterField>

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  checked={Boolean(filters.needsReviewOnly)}
                  onChange={(event) => update({ needsReviewOnly: event.target.checked })}
                />
                Needs review only
              </label>
            </div>
          </div>
        ) : null}

        {/* Amount filters compare magnitudes, which is not obvious from a
            field labelled "minimum amount". */}
        {filters.minAmount != null || filters.maxAmount != null ? (
          <p className="text-xs text-muted-foreground">
            Amount filters match the size of a transaction, so they include both money in and money
            out.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function countActiveFilters(filters: TransactionFilters): number {
  let count = 0;
  if (filters.accountIds?.length) count += 1;
  if (filters.institutionIds?.length) count += 1;
  if (filters.categories?.length) count += 1;
  if (filters.economicTypes?.length) count += 1;
  if (filters.minAmount != null) count += 1;
  if (filters.maxAmount != null) count += 1;
  if (filters.status && filters.status !== 'ALL') count += 1;
  if (filters.transferStatus && filters.transferStatus !== 'ALL') count += 1;
  if (filters.needsReviewOnly) count += 1;
  if (filters.exclusionBucket) count += 1;
  return count;
}
