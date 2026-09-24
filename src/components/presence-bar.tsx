import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { BadgeColors, Spacing, type BadgeTone } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import type { PresenceMember } from '@/lib/realtime/live';

const TONES: BadgeTone[] = ['brand', 'positive', 'warning', 'neutral'];
const MAX_AVATARS = 3;
const SIZE = 26;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Who else has this list or week open right now: overlapping initials and a
 * short line ("Anna is here too"). Renders nothing when you're alone.
 */
export function PresenceBar({ members, align = 'start' }: { members: PresenceMember[]; align?: 'start' | 'center' }) {
  const t = useT();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  if (members.length === 0) return null;

  const [a, b] = members.map((m) => firstName(m.name));
  const label = members.length === 1
    ? t('presence.one', { a })
    : members.length === 2
      ? t('presence.two', { a, b })
      : t('presence.many', { a, b, count: members.length - 2 });
  const shown = members.slice(0, MAX_AVATARS);
  const extra = members.length - shown.length;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.row, align === 'center' && styles.center]}>
      <View style={styles.stack}>
        {shown.map((member, index) => {
          const colors = BadgeColors[scheme][TONES[member.id % TONES.length]];
          return (
            <View
              key={member.id}
              style={[
                styles.avatar,
                { backgroundColor: colors.bg, borderColor: theme.background, marginLeft: index === 0 ? 0 : -8 },
              ]}>
              <ThemedText style={[styles.initials, { color: colors.fg }]}>{initials(member.name)}</ThemedText>
            </View>
          );
        })}
        {extra > 0 ? (
          <View style={[styles.avatar, styles.more, { backgroundColor: theme.backgroundSelected, borderColor: theme.background }]}>
            <ThemedText style={[styles.initials, { color: theme.textSecondary }]}>+{extra}</ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.label}>
        {label}
      </ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  center: {
    justifyContent: 'center',
  },
  stack: {
    flexDirection: 'row',
  },
  avatar: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  more: {
    marginLeft: -8,
  },
  initials: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: 700,
  },
  label: {
    flexShrink: 1,
  },
});
