import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Children, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BadgeColors, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';

const ICON_TILE = 32;

/** A titled block of settings, with an optional explanatory footer under it. */
export function SettingsSection({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {title ? (
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.inset}>
          {title}
        </ThemedText>
      ) : null}
      {children}
      {footer ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.inset}>
          {footer}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** One rounded surface holding rows, separated by hairlines that start at the text edge. */
export function SettingsGroup({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const rows = Children.toArray(children);
  return (
    <ThemedView type="backgroundElement" style={styles.group}>
      {rows.map((row, index) => (
        <View key={index}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: theme.border }]} /> : null}
          {row}
        </View>
      ))}
    </ThemedView>
  );
}

export type SettingsRowProps = {
  icon: SymbolViewProps['name'];
  title: string;
  subtitle?: string;
  /**
   * `brand` marks the section's main action, `danger` a destructive one; everything
   * else stays neutral so the colored rows stand out.
   */
  tone?: 'neutral' | 'brand' | 'danger';
  /** What the row does when tapped: push a screen, leave the app, or act in place. */
  accessory?: 'chevron' | 'external' | 'none';
  /** Content on the trailing edge, before the accessory (a badge, a value). */
  trailing?: ReactNode;
  /** Extra content under the title/subtitle (e.g. a status line). */
  children?: ReactNode;
  loading?: boolean;
  onPress?: () => void;
};

export function SettingsRow({
  icon,
  title,
  subtitle,
  tone = 'neutral',
  accessory = 'chevron',
  trailing,
  children,
  loading = false,
  onPress,
}: SettingsRowProps) {
  const theme = useTheme();
  const badges = BadgeColors[useResolvedScheme()];
  const tile =
    tone === 'neutral' ? { bg: theme.backgroundSelected, fg: theme.text } : badges[tone];
  const titleColor = tone === 'danger' ? badges.danger.fg : theme.text;

  const content = (
    <>
      <View style={[styles.tile, { backgroundColor: tile.bg }]}>
        <SymbolView name={icon} size={16} tintColor={tile.fg} type="monochrome" />
      </View>
      <View style={styles.text}>
        <ThemedText style={[styles.title, { color: titleColor }]}>{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
        {children}
      </View>
      {trailing}
      {loading ? (
        <ActivityIndicator size="small" color={theme.textSecondary} />
      ) : onPress && accessory !== 'none' ? (
        <SymbolView
          name={
            accessory === 'external'
              ? { ios: 'arrow.up.right', android: 'open_in_new', web: 'open_in_new' }
              : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }
          }
          size={12}
          tintColor={theme.textSecondary}
          type="monochrome"
        />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{content}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole={accessory === 'external' ? 'link' : 'button'}
      accessibilityState={{ disabled: loading, busy: loading }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  // Titles and footers line up with the text inside the group, not its edge.
  inset: {
    paddingHorizontal: Spacing.one,
  },
  group: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + ICON_TILE + Spacing.two + Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    minHeight: 56,
  },
  tile: {
    width: ICON_TILE,
    height: ICON_TILE,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.6,
  },
});
