import { ActivityIndicator, StyleSheet } from 'react-native';

import { PressableScale, type PressableScaleProps } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { BadgeColors, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';

export type ButtonProps = Omit<PressableScaleProps, 'scaleTo'> & {
  title: string;
  loading?: boolean;
  /** `danger` is the soft red tint for destructive actions (remove, delete). */
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'default' | 'small';
};

export function Button({
  title,
  loading = false,
  variant = 'primary',
  size = 'default',
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const danger = BadgeColors[useResolvedScheme()].danger;
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const isDisabled = disabled || loading;
  const background = isPrimary ? theme.tint : isDanger ? danger.bg : theme.backgroundSelected;
  const foreground = isPrimary ? theme.onTint : isDanger ? danger.fg : theme.text;

  return (
    <PressableScale
      accessibilityRole="button"
      // The title is replaced by a spinner while loading; keep the name for VoiceOver.
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={[
        styles.base,
        size === 'small' && styles.small,
        { backgroundColor: background },
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <ThemedText
          type={size === 'small' ? 'small' : 'default'}
          style={[styles.label, { color: foreground }]}>
          {title}
        </ThemedText>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: {
    minHeight: 38,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  label: {
    fontWeight: 600,
  },
  disabled: {
    opacity: 0.5,
  },
});
