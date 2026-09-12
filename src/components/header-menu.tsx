import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { useT } from '@/lib/i18n';

/**
 * A native "more" menu in the navigation header (right side), holding the
 * screen-level actions that used to sit as buttons in the content: rename,
 * clear, delete. Children are `MenuAction`s.
 *
 * iOS shows the ellipsis symbol; Android's header menu can't render SF Symbols
 * at the root, so it gets a text label instead.
 */
export function HeaderMenu({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu
        accessibilityLabel={t('common.more')}
        icon={Platform.OS === 'ios' ? 'ellipsis.circle' : undefined}>
        {Platform.OS !== 'ios' ? <Stack.Toolbar.Label>{t('common.more')}</Stack.Toolbar.Label> : null}
        {children}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

export const MenuAction = Stack.Toolbar.MenuAction;
