import { useState } from 'react';
import AppShell, { type ViewId } from '@/components/AppShell';
import DashboardView from '@/views/DashboardView';
import ProductsView from '@/views/ProductsView';
import SettingsView from '@/views/SettingsView';
import VendorsView from '@/views/VendorsView';

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>('dashboard');

  return (
    <AppShell activeView={activeView} onNavigate={setActiveView}>
      {activeView === 'dashboard' && <DashboardView onNavigate={setActiveView} />}
      {activeView === 'vendors' && <VendorsView />}
      {activeView === 'products' && <ProductsView />}
      {activeView === 'settings' && <SettingsView />}
    </AppShell>
  );
}
