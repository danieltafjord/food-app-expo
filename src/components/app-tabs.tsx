import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

export default function AppTabs() {
  const colors = Colors[useResolvedScheme()];
  const t = useT();

  return (
    <NativeTabs
      backgroundColor={colors.background}
      // Solid (non-translucent) bar so app content doesn't show through it, and a
      // hairline top separator.
      blurEffect="none"
      disableTransparentOnScrollEdge
      shadowColor={colors.border}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('tabs.plans')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="dinners">
        <NativeTabs.Trigger.Label>{t('tabs.dinners')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="fork.knife" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="shopping">
        <NativeTabs.Trigger.Label>{t('tabs.shopping')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="cart.fill" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>{t('tabs.account')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape.fill" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
