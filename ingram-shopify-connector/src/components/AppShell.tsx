import type { LucideIcon } from 'lucide-react';
import { Boxes, LayoutDashboard, PackageSearch, Settings, Store } from 'lucide-react';
import type { ReactNode } from 'react';

export type ViewId = 'dashboard' | 'vendors' | 'products' | 'settings';

const NAV_ITEMS: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'vendors', label: 'Vendors', icon: Boxes },
  { id: 'products', label: 'Products', icon: PackageSearch },
  { id: 'settings', label: 'Settings', icon: Settings },
];

type AppShellProps = {
  activeView: ViewId;
  onNavigate: (view: ViewId) => void;
  children: ReactNode;
};

export default function AppShell({ activeView, onNavigate, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Ingram Sync</p>
              <p className="text-xs text-slate-500">Ingram Micro to Shopify</p>
            </div>
          </div>

          <nav className="-mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Main">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeView;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
    </div>
  );
}
