import type { Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextFieldProps = TextInputProps & {
  /** Reaches the underlying TextInput (e.g. to focus it once a sheet has presented). */
  ref?: Ref<TextInput>;
  label: string;
  /** Leave the label unseen when the row above already names the field. */
  hideLabel?: boolean;
  /** First validation message for this field, if any. */
  error?: string | null;
};

export function TextField({ ref, label, hideLabel = false, error, style, ...rest }: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      {hideLabel ? null : <ThemedText type="smallBold">{label}</ThemedText>}
      <TextInput
        ref={ref}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { backgroundColor: theme.backgroundElement, color: theme.text },
          !!error && { borderWidth: 1, borderColor: theme.danger },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.one,
  },
  input: {
    minHeight: 48,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
