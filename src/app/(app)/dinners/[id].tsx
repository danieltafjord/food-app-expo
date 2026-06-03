import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { IngredientPicker } from '@/components/ingredient-picker';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import {
  deleteDinner,
  getIngredient,
  updateDinner,
  useDinner,
  type DinnerWithItems,
  type LocalIngredient,
} from '@/lib/store';

export default function DinnerEditorScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ id: string }>();
  const dinner = useDinner(params.id);

  if (!dinner) {
    return (
      <Screen topInset={false} refreshable={false}>
        <Card>
          <ThemedText type="subtitle">{t('dinners.notFound')}</ThemedText>
          <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  // Mount the form only once we have the dinner so its state seeds from props
  // (a lazy useState initializer) — no data-syncing effect needed.
  return <DinnerEditorForm key={dinner.id} dinner={dinner} />;
}

type EditorItem = {
  ingredient_id: string;
  ingredient_name: string;
  quantity: string;
  unit: string;
};

function DinnerEditorForm({ dinner }: { dinner: DinnerWithItems }) {
  const t = useT();
  const theme = useTheme();
  const [name, setName] = useState(dinner.name);
  const [servings, setServings] = useState(String(dinner.default_servings));
  const [notes, setNotes] = useState(dinner.notes ?? '');
  const [items, setItems] = useState<EditorItem[]>(() =>
    dinner.items.map((item) => ({
      ingredient_id: item.ingredient_id,
      ingredient_name: getIngredient(item.ingredient_id)?.name ?? t('common.ingredientFallback'),
      quantity: item.quantity != null ? String(item.quantity) : '',
      unit: item.unit ?? '',
    })),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  function addIngredient(ingredient: LocalIngredient) {
    setPickerOpen(false);
    setItems((current) => {
      if (current.some((item) => item.ingredient_id === ingredient.id)) {
        return current;
      }
      return [
        ...current,
        {
          ingredient_id: ingredient.id,
          ingredient_name: ingredient.name,
          quantity: '',
          unit: ingredient.default_unit ?? '',
        },
      ];
    });
  }

  function updateItem(index: number, patch: Partial<EditorItem>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, i) => i !== index));
  }

  function onSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    updateDinner(dinner.id, {
      name: trimmed,
      default_servings: Math.max(1, parseInt(servings, 10) || 1),
      notes: notes.trim() || null,
      items: items.map((item) => ({
        ingredient_id: item.ingredient_id,
        quantity: item.quantity.trim() ? Number(item.quantity) : null,
        unit: item.unit.trim() || null,
      })),
    });
    router.back();
  }

  function onDelete() {
    deleteDinner(dinner.id);
    router.back();
  }

  return (
    <Screen topInset={false} refreshable={false}>
      <TextField
        label={t('dinners.name')}
        value={name}
        onChangeText={setName}
        autoCapitalize="sentences"
      />
      <TextField
        label={t('dinners.defaultServings')}
        value={servings}
        onChangeText={setServings}
        keyboardType="number-pad"
        inputMode="numeric"
      />

      <View style={styles.section}>
        <ThemedText type="smallBold">{t('dinners.ingredients')}</ThemedText>
        <Card>
          {items.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('dinners.noIngredients')}
            </ThemedText>
          ) : (
            items.map((item, index) => (
              <View
                key={item.ingredient_id}
                style={[
                  styles.item,
                  index > 0 && { ...styles.divider, borderTopColor: theme.border },
                ]}>
                <ThemedText numberOfLines={1}>{item.ingredient_name}</ThemedText>
                <View style={styles.itemControls}>
                  <View style={styles.qty}>
                    <TextField
                      label={t('dinners.qty')}
                      value={item.quantity}
                      onChangeText={(value) => updateItem(index, { quantity: value })}
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </View>
                  <View style={styles.unit}>
                    <TextField
                      label={t('dinners.unit')}
                      value={item.unit}
                      onChangeText={(value) => updateItem(index, { unit: value })}
                      autoCapitalize="none"
                      placeholder="g"
                    />
                  </View>
                  <Pressable onPress={() => removeItem(index)} hitSlop={10} style={styles.removeItem}>
                    <ThemedText themeColor="textSecondary">✕</ThemedText>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </Card>
        <Button
          title={t('dinners.addIngredient')}
          variant="secondary"
          size="small"
          onPress={() => setPickerOpen(true)}
        />
      </View>

      <TextField
        label={t('dinners.notes')}
        value={notes}
        onChangeText={setNotes}
        placeholder={t('dinners.notesPlaceholder')}
        multiline
      />

      <Button title={t('dinners.saveDinner')} onPress={onSave} disabled={!name.trim()} />
      <Button title={t('dinners.deleteDinner')} variant="secondary" onPress={onDelete} />

      <IngredientPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addIngredient}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  item: {
    gap: Spacing.two,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    marginTop: Spacing.one,
  },
  itemControls: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  qty: {
    width: 80,
  },
  unit: {
    width: 80,
  },
  removeItem: {
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
});
