import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type PressableStateCallbackType,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BadgeColors, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';

export type ButtonProps = Omit<PressableProps, 'style'> & {
  title: string;
  loading?: boolean;
  /** `danger` is the soft red tint for destructive actions (remove, delete). */
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'default' | 'small';
  style?: PressableProps['style'];
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
    <Pressable
      accessibilityRole="button"
      // The title is replaced by a spinner while loading; keep the name for VoiceOver.
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={(state: PressableStateCallbackType) => [
        styles.base,
        size === 'small' && styles.small,
        { backgroundColor: background },
        isDisabled && styles.disabled,
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
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
    </Pressable>
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
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
});
