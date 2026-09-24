import { View } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { GlobalSyncBanner } from '@/components/global-sync-banner';
import { UndoToast } from '@/components/undo-toast';

// The main app. Local-first, so it renders with or without a cloud account.
// The sync banner and the Undo toast float above the tabs, visible from every screen.
export default function AppLayout() {
  return (
    <View style={{ flex: 1 }}>
      <AppTabs />
      <GlobalSyncBanner />
      <UndoToast />
    </View>
  );
}
