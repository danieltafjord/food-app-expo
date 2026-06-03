import { View } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { GlobalSyncBanner } from '@/components/global-sync-banner';

// The main app. Local-first, so it renders with or without a cloud account.
// The sync banner floats above the tabs and is visible from every screen.
export default function AppLayout() {
  return (
    <View style={{ flex: 1 }}>
      <AppTabs />
      <GlobalSyncBanner />
    </View>
  );
}
