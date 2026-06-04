import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { CategoryPicker } from '@/components/category-picker';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { type CategoryId } from '@/lib/categorize';
import { useT } from '@/lib/i18n';
import type { ShoppingListItemWithIngredient } from '@/lib/store';

export type ShoppingItemEdit = {
  name: string | null;
  quantity: number | null;
  unit: string | null;
  category: CategoryId;
};

type Props = {
  item: ShoppingListItemWithIngredient | null;
  onClose: () => void;
  onSave: (item: ShoppingListItemWithIngredient, edit: ShoppingItemEdit) => void;
  onRemove: (item: ShoppingListItemWithIngredient) => void;
};

/** Bottom sheet to edit a shopping-list item's quantity, unit, and (free-text) name. */
export function ShoppingItemEditor({ item, onClose, onSave, onRemove }: Props) {
  return (
    <BottomSheet visible={!!item} onClose={onClose}>
      {item ? (
        <ItemForm key={item.id} item={item} onClose={onClose} onSave={onSave} onRemove={onRemove} />
      ) : null}
    </BottomSheet>
  );
}

function ItemForm({ item, onClose, onSave, onRemove }: Omit<Props, 'item'> & { item: ShoppingListItemWithIngredient }) {
  const t = useT();
  const isFreeText = item.ingredient_id == null;
  const [name, setName] = useState(item.name ?? '');
  const [quantity, setQuantity] = useState(item.quantity != null ? String(item.quantity) : '');
  const [unit, setUnit] = useState(item.unit ?? '');
  const [category, setCategory] = useState<CategoryId>(item.category);

  // A free-text item must keep a name; an ingredient-backed one keeps its ingredient.
  const canSave = !isFreeText || !!name.trim();

  function save() {
    onSave(item, {
      name: isFreeText ? name.trim() || null : item.name,
      quantity: quantity.trim() ? Number(quantity) : null,
      unit: unit.trim() || null,
      category,
    });
  }

  return (
    <>
      <ThemedText type="subtitle" numberOfLines={1}>
        {isFreeText ? t('shoppingItemEditor.editItem') : (item.ingredient_name ?? t('common.ingredientFallback'))}
      </ThemedText>

      {isFreeText ? (
        <TextField label={t('shopping.item')} value={name} onChangeText={setName} autoCapitalize="sentences" />
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
        <CategoryPicker value={category} onChange={setCategory} />
      </View>

      <Button title={t('common.save')} onPress={save} disabled={!canSave} />
      <View style={styles.footer}>
        <Button title={t('common.remove')} variant="secondary" style={styles.flex} onPress={() => onRemove(item)} />
        <Button title={t('common.cancel')} variant="secondary" style={styles.flex} onPress={onClose} />
      </View>
    </>
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
  footer: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  flex: {
    flex: 1,
  },
});
