import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { SheetScreen } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { cancelSheet, resolveSheet } from '@/lib/sheets';
import { createIngredient, getIngredient, useIngredients, type LocalIngredient } from '@/lib/store';

/**
 * Search the ingredient catalogue or create a new entry. The pick is handed
 * back to the opener through `@/lib/sheets` (param `request`) because it lands
 * in the dinner editor's unsaved draft, not in the store.
 */
export default function IngredientPickerSheet() {
  const t = useT();
  const theme = useTheme();
  const { request } = useLocalSearchParams<{ request: string }>();
  const all = useIngredients();
  const [query, setQuery] = useState('');
  // One create per typed query — guards a "done" + button tap firing twice.
  const created = useRef(false);

  // Dismissed without picking: release the opener's callback.
  useEffect(() => () => cancelSheet(request), [request]);

  const trimmed = query.trim();
  const filtered = trimmed
    ? all.filter((item) => item.name.toLowerCase().includes(trimmed.toLowerCase()))
    : all;
  const exactMatch = all.some((item) => item.name.toLowerCase() === trimmed.toLowerCase());

  function pick(ingredient: LocalIngredient) {
    resolveSheet(request, ingredient);
    router.back();
  }

  function onCreate() {
    if (!trimmed || created.current) return;
    created.current = true;
    const ingredient = getIngredient(createIngredient({ name: trimmed }));
    if (ingredient) pick(ingredient);
  }

  return (
    <SheetScreen title={t('ingredientPicker.title')} layout="fill">
      <TextField
        label={t('ingredientPicker.searchOrCreate')}
        placeholder={t('ingredientPicker.placeholder')}
        value={query}
        onChangeText={(text) => {
          created.current = false;
          setQuery(text);
        }}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (trimmed && !exactMatch) onCreate();
        }}
      />

      {trimmed && !exactMatch ? (
        <Button title={t('ingredientPicker.create', { name: trimmed })} onPress={onCreate} />
      ) : null}

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {filtered.length > 0 ? (
          filtered.map((ingredient) => (
            <Pressable
              key={ingredient.id}
              onPress={() => pick(ingredient)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: theme.border },
                pressed && styles.pressed,
              ]}>
              <ThemedText style={styles.flex} numberOfLines={1}>
                {ingredient.name}
              </ThemedText>
              {ingredient.default_unit ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {ingredient.default_unit}
                </ThemedText>
              ) : null}
            </Pressable>
          ))
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {trimmed ? t('ingredientPicker.noMatches') : t('ingredientPicker.empty')}
          </ThemedText>
        )}
      </ScrollView>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: {
    flexShrink: 1,
    flexGrow: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
