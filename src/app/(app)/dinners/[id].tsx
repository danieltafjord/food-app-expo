import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { parseQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { openIngredientPicker } from '@/lib/sheets';
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

/** Snapshot of the editable fields, for a cheap "has anything changed" check. */
function draftKey(name: string, servings: string, notes: string, items: EditorItem[]): string {
  return JSON.stringify([name, servings, notes, items]);
}

function DinnerEditorForm({ dinner }: { dinner: DinnerWithItems }) {
  const t = useT();
  const theme = useTheme();
  const navigation = useNavigation();
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
  // What the form looked like when it opened; compared against the live draft
  // to decide whether leaving would lose anything.
  const [initialKey] = useState(() => draftKey(name, servings, notes, items));
  const dirty = draftKey(name, servings, notes, items) !== initialKey;
  // Set by Save / Delete right before they navigate back, so the guard below
  // lets a deliberate exit through without asking.
  const leaving = useRef(false);

  // Edits live only in this form until "Save"; the header back button and the
  // swipe-back gesture would otherwise throw them away silently. Intercept the
  // removal and ask first.
  useEffect(() => {
    if (!dirty) return;
    return navigation.addListener('beforeRemove', (event) => {
      if (leaving.current) return;
      event.preventDefault();
      Alert.alert(t('dinners.discardTitle'), t('dinners.discardMessage'), [
        { text: t('dinners.keepEditing'), style: 'cancel' },
        {
          text: t('dinners.discard'),
          style: 'destructive',
          onPress: () => navigation.dispatch(event.data.action),
        },
      ]);
    });
  }, [navigation, dirty, t]);

  function addIngredient(ingredient: LocalIngredient) {
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
        quantity: parseQuantity(item.quantity),
        unit: item.unit.trim() || null,
      })),
    });
    leaving.current = true;
    router.back();
  }

  function onDelete() {
    Alert.alert(t('dinners.deleteDinnerTitle'), t('dinners.deleteDinnerMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          deleteDinner(dinner.id);
          leaving.current = true;
          router.back();
        },
      },
    ]);
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
                  <Pressable
                    onPress={() => removeItem(index)}
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.removeIngredient')}
                    hitSlop={10}
                    style={styles.removeItem}>
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
          onPress={() => openIngredientPicker(addIngredient)}
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
