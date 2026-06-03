import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type PressableStateCallbackType,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonProps = Omit<PressableProps, 'style'> & {
  title: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
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
  const isPrimary = variant === 'primary';
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={(state: PressableStateCallbackType) => [
        styles.base,
        size === 'small' && styles.small,
        { backgroundColor: isPrimary ? theme.tint : theme.backgroundSelected },
        isDisabled && styles.disabled,
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={isPrimary ? theme.onTint : theme.text} />
      ) : (
        <ThemedText
          type={size === 'small' ? 'small' : 'default'}
          style={styles.label}
          themeColor={isPrimary ? 'onTint' : 'text'}>
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
