import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { createDinner, getDinner, useDinners, type DinnerWithItems } from '@/lib/store';

type DinnerPickerProps = {
  visible: boolean;
  date: string | null;
  /** Disables selection while the parent is busy (rarely needed now writes are local). */
  busy?: boolean;
  onClose: () => void;
  onPick: (dinner: DinnerWithItems) => void;
};

/** Bottom sheet to pick an existing dinner or quick-create one, for a given day. */
export function DinnerPicker({ visible, date, busy, onClose, onPick }: DinnerPickerProps) {
  const t = useT();
  const theme = useTheme();
  const dinners = useDinners();
  const [name, setName] = useState('');

  function onQuickCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    const id = createDinner({ name: trimmed });
    setName('');
    const dinner = getDinner(id);
    if (dinner) {
      onPick(dinner);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheetCap}>
      <ThemedText type="subtitle">{t('dinnerPicker.title')}</ThemedText>
      {date ? (
        <ThemedText type="small" themeColor="textSecondary">
          {formatDate(date)}
        </ThemedText>
      ) : null}

      <View style={styles.createRow}>
        <View style={styles.flex}>
          <TextField
            label={t('dinnerPicker.newDinner')}
            placeholder={t('dinnerPicker.placeholder')}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={onQuickCreate}
          />
        </View>
        <Button
          title={t('common.add')}
          onPress={onQuickCreate}
          disabled={!name.trim()}
          style={styles.addButton}
        />
      </View>

      <ThemedText type="smallBold">{t('dinnerPicker.yourDinners')}</ThemedText>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {dinners.length > 0 ? (
          dinners.map((dinner) => (
            <Pressable
              key={dinner.id}
              onPress={() => onPick(dinner)}
              disabled={busy}
              style={({ pressed }) => [
                styles.dinnerRow,
                { borderBottomColor: theme.border },
                pressed && styles.pressed,
              ]}>
              <ThemedText style={styles.flex} numberOfLines={1}>
                {dinner.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('dinnerPicker.servingsCount', { count: dinner.default_servings })}
              </ThemedText>
            </Pressable>
          ))
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {t('dinnerPicker.empty')}
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
  createRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  addButton: {
    minWidth: 72,
  },
  list: {
    maxHeight: 280,
  },
  dinnerRow: {
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
