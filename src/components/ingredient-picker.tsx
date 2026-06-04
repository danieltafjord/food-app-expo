import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { createIngredient, getIngredient, useIngredients, type LocalIngredient } from '@/lib/store';

type IngredientPickerProps = {
  visible: boolean;
  onClose: () => void;
  onPick: (ingredient: LocalIngredient) => void;
};

/** Bottom sheet to search the ingredient catalogue or create a new entry. */
export function IngredientPicker({ visible, onClose, onPick }: IngredientPickerProps) {
  const t = useT();
  const theme = useTheme();
  const all = useIngredients();
  const [query, setQuery] = useState('');
  // One create per typed query — guards a "done" + button tap firing twice.
  const created = useRef(false);

  const trimmed = query.trim();
  const filtered = trimmed
    ? all.filter((item) => item.name.toLowerCase().includes(trimmed.toLowerCase()))
    : all;
  const exactMatch = all.some((item) => item.name.toLowerCase() === trimmed.toLowerCase());

  function onCreate() {
    if (!trimmed || created.current) {
      return;
    }
    created.current = true;
    const id = createIngredient({ name: trimmed });
    setQuery('');
    const ingredient = getIngredient(id);
    if (ingredient) {
      onPick(ingredient);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheetCap}>
      <ThemedText type="subtitle">{t('ingredientPicker.title')}</ThemedText>

      <TextField
        label={t('ingredientPicker.searchOrCreate')}
        placeholder={t('ingredientPicker.placeholder')}
        value={query}
        onChangeText={(text) => {
          created.current = false;
          setQuery(text);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (trimmed && !exactMatch) {
            onCreate();
          }
        }}
      />

      {trimmed && !exactMatch ? (
        <Button title={t('ingredientPicker.create', { name: trimmed })} onPress={onCreate} />
      ) : null}

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {filtered.length > 0 ? (
          filtered.map((ingredient) => (
            <Pressable
              key={ingredient.id}
              onPress={() => onPick(ingredient)}
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

      <Button title={t('common.cancel')} variant="secondary" onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetCap: {
    maxHeight: '80%',
  },
  list: {
    maxHeight: 280,
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
