import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { CategorySelect } from '@/components/category-select';
import { SheetScreen } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type CategoryId } from '@/lib/categorize';
import { parseQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';
import {
  recategorizeShoppingItem,
  removeShoppingItem,
  updateShoppingItem,
  useShoppingItem,
  type ShoppingListItemWithIngredient,
} from '@/lib/store';

/** Edit a shopping-list item's quantity, unit, aisle and (free-text) name. */
export default function ShoppingItemSheet() {
  const t = useT();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const item = useShoppingItem(itemId);

  if (!item) {
    return (
      <SheetScreen title={t('shoppingItemEditor.editItem')}>
        <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      </SheetScreen>
    );
  }
  return <ItemForm key={item.id} item={item} />;
}

function ItemForm({ item }: { item: ShoppingListItemWithIngredient }) {
  const t = useT();
  const theme = useTheme();
  const isFreeText = item.ingredient_id == null;
  const [name, setName] = useState(item.name ?? '');
  const [quantity, setQuantity] = useState(item.quantity != null ? String(item.quantity) : '');
  const [unit, setUnit] = useState(item.unit ?? '');
  const [category, setCategory] = useState<CategoryId>(item.category);

  // A free-text item must keep a name; an ingredient-backed one keeps its ingredient.
  const canSave = !isFreeText || !!name.trim();

  function save() {
    updateShoppingItem(item.id, {
      name: isFreeText ? name.trim() || null : item.name,
      quantity: parseQuantity(quantity),
      unit: unit.trim() || null,
    });
    if (category !== item.category) {
      recategorizeShoppingItem(item.id, category);
    }
    router.back();
  }

  function remove() {
    removeShoppingItem(item.id);
    router.back();
  }

  return (
    <SheetScreen
      title={
        isFreeText
          ? t('shoppingItemEditor.editItem')
          : (item.ingredient_name ?? t('common.ingredientFallback'))
      }>
      {isFreeText ? (
        <TextField
          label={t('shopping.item')}
          value={name}
          onChangeText={setName}
          autoCapitalize="sentences"
        />
      ) : null}

      <View style={styles.qtyRow}>
        <View style={styles.flex}>
          <TextField
            label={t('shoppingItemEditor.quantity')}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            inputMode="decimal"
            placeholder="0"
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label={t('shoppingItemEditor.unit')}
            value={unit}
            onChangeText={setUnit}
            autoCapitalize="none"
            placeholder="g"
          />
        </View>
      </View>

      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('shoppingItemEditor.category')}
        </ThemedText>
        <CategorySelect value={category} onChange={setCategory} />
      </View>

      {/* Cancel + Save as a pair; removal is red and below a divider so it
          can't be mistaken for "cancel" (same layout as the entry editor). */}
      <View style={styles.actions}>
        <Button
          title={t('common.cancel')}
          variant="secondary"
          onPress={() => router.back()}
          style={styles.flex}
        />
        <Button title={t('common.save')} onPress={save} disabled={!canSave} style={styles.flex} />
      </View>

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      <Button title={t('shoppingItemEditor.remove')} variant="danger" onPress={remove} />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  qtyRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
  flex: {
    flex: 1,
  },
});
