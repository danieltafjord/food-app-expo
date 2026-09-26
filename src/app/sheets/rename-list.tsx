import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { SheetScreen } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { Spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { renameShoppingList, useShoppingList } from '@/lib/store';

/** Rename a shopping list (`listId`). Lists are created without asking for a name. */
export default function RenameListSheet() {
  const t = useT();
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const list = useShoppingList(listId);
  const [name, setName] = useState(list?.name ?? '');
  // Once per sheet: the return key and a tap on Save would otherwise pop two screens.
  const saved = useRef(false);

  function onSave() {
    const trimmed = name.trim();
    if (!trimmed || !listId || saved.current) return;
    saved.current = true;
    renameShoppingList(listId, trimmed);
    router.back();
  }

  return (
    <SheetScreen title={t('shopping.renameList')}>
      <TextField
        label={t('shopping.name')}
        placeholder={t('shopping.namePlaceholder')}
        maxLength={255}
        value={name}
        onChangeText={setName}
        autoCapitalize="sentences"
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={onSave}
      />
      <View style={styles.actions}>
        <Button
          title={t('common.cancel')}
          variant="secondary"
          onPress={() => router.back()}
          style={styles.action}
        />
        <Button title={t('common.save')} onPress={onSave} disabled={!name.trim()} style={styles.action} />
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
});
