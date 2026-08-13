import {
  ArrowLeftRight,
  BarChart3,
  ChevronDown,
  CreditCard,
  LogOut,
  Menu,
  MessageCircle,
  PieChart,
  Settings,
} from 'lucide-react';
import * as React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { AtlasLogo } from '@/components/common/logo';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/features/auth/auth-context';
import { useTransferReviewCount } from '@/features/transfers/hooks';
import { cn } from '@/lib/utils';

/**
 * Persistent application shell.
 *
 * Desktop keeps the sidebar always visible; below `lg` it collapses into a
 * drawer so the content area stays usable on tablet and mobile. Navigation is a
 * <nav> of real links, so browser back/forward, middle-click and keyboard
 * traversal all behave normally.
 */

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: PieChart, end: true },
  { to: '/accounts', label: 'Accounts', icon: CreditCard },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/cash-flow', label: 'Cash Flow', icon: BarChart3 },
  { to: '/chat', label: 'Chat', icon: MessageCircle },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const location = useLocation();

  // Close the drawer on navigation; leaving it open over the new page is
  // disorienting on touch devices.
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 p-0 sm:max-w-xs">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenNav={() => setMobileNavOpen(true)} />
        <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarContent() {
  const reviewCount = useTransferReviewCount();

  return (
    <>
      <div className="flex h-16 items-center border-b border-sidebar-border px-5">
        <AtlasLogo />
      </div>

      <nav aria-label="Main" className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className="size-[1.15rem] shrink-0" aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {/* Transfer review is time-sensitive: unreviewed matches make
                    spending figures provisional, so the count is surfaced in
                    navigation rather than buried on one screen. */}
                {item.to === '/transactions' && reviewCount > 0 ? (
                  <span
                    className="rounded-full bg-finance-warning/15 px-1.5 py-0.5 text-xs font-semibold text-finance-warning"
                    aria-label={`${reviewCount} transfers need review`}
                  >
                    {reviewCount}
                  </span>
                ) : null}
                {isActive ? <span className="sr-only">(current page)</span> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { user, signOut } = useAuth();
  const email = user?.email ?? '';
  const initials = email.slice(0, 2).toUpperCase() || '··';

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenNav}
        aria-label="Open navigation"
      >
        <Menu aria-hidden="true" />
      </Button>

      <div className="lg:hidden">
        <AtlasLogo showWordmark={false} />
      </div>

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 px-2">
              <span
                className="flex size-8 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary"
                aria-hidden="true"
              >
                {initials}
              </span>
              <span className="hidden max-w-[12rem] truncate text-sm font-medium sm:inline">
                {email}
              </span>
              <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
