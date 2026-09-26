import { useEffect } from 'react';
import { View } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { GlobalSyncBanner } from '@/components/global-sync-banner';
import { NotificationsBridge } from '@/components/notifications-bridge';
import { UndoToast } from '@/components/undo-toast';
import { runArchiveMaintenance } from '@/lib/store/archiving';

// The main app. Local-first, so it renders with or without a cloud account.
// The sync banner and the Undo toast float above the tabs, visible from every screen.
// Notifications are wired here, inside the navigator, so a tap can navigate.
export default function AppLayout() {
  // Once per launch, after the first screen: archive finished lists and move
  // archived lists' items out of the store (see `@/lib/store/archiving`).
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(runArchiveMaintenance, { timeout: 5000 });
      else runArchiveMaintenance();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <AppTabs />
      <GlobalSyncBanner />
      <UndoToast />
      <NotificationsBridge />
    </View>
  );
}
