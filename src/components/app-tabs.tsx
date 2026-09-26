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
      // iOS 18 and earlier: a solid bar with a hairline top separator. iOS 26
      // ignores these and draws Liquid Glass (content scrolls under it).
      // Outlined symbols at rest, filled when selected, where a fill exists.
      blurEffect="none"
      disableTransparentOnScrollEdge
      shadowColor={colors.border}
      indicatorColor={colors.backgroundElement}
      // Without a tint the selected icon falls back to system blue.
      tintColor={colors.tint}
      labelStyle={{ selected: { color: colors.text } }}>
      {/* Icon-only, so each trigger carries its label for VoiceOver instead. */}
      <NativeTabs.Trigger name="index" accessibilityLabel={t('tabs.plans')}>
        <NativeTabs.Trigger.Label hidden>{t('tabs.plans')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="dinners" accessibilityLabel={t('tabs.dinners')}>
        <NativeTabs.Trigger.Label hidden>{t('tabs.dinners')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="fork.knife" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="shopping" accessibilityLabel={t('tabs.shopping')}>
        <NativeTabs.Trigger.Label hidden>{t('tabs.shopping')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'cart', selected: 'cart.fill' }} />
      </NativeTabs.Trigger>

      {/* The `search` role is only borrowed for its placement: on iOS 26 it
          detaches the tab into its own circle at the trailing edge. The
          custom icon replaces the magnifying glass. */}
      <NativeTabs.Trigger name="account" role="search" accessibilityLabel={t('tabs.account')}>
        <NativeTabs.Trigger.Label hidden>{t('tabs.account')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
