import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { SheetScreen } from '@/components/sheet';
import { Stepper } from '@/components/stepper';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import {
  deletePlanEntry,
  updatePlanEntry,
  usePlanEntry,
  type PlanEntryWithDinner,
} from '@/lib/store';

/**
 * Edit a scheduled dinner (`entryId`): change its servings or remove it. Moving
 * it to another day is done by dragging the card on the week board.
 *
 * Cancel and Save sit together as the form's pair; removing the dinner from
 * the plan is a separate, red action below a divider so it can't be mistaken
 * for "cancel".
 */
export default function EntryEditorSheet() {
  const t = useT();
  const { entryId } = useLocalSearchParams<{ entryId: string }>();
  const entry = usePlanEntry(entryId);

  // Gone (deleted on another device while open): nothing to edit.
  if (!entry) {
    return (
      <SheetScreen title={t('common.dinnerFallback')}>
        <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      </SheetScreen>
    );
  }
  return <EntryForm key={entry.id} entry={entry} />;
}

function EntryForm({ entry }: { entry: PlanEntryWithDinner }) {
  const t = useT();
  const theme = useTheme();
  const [servings, setServings] = useState(entry.servings);

  function save() {
    updatePlanEntry(entry.id, { servings });
    router.back();
  }

  function remove() {
    deletePlanEntry(entry.id);
    router.back();
  }

  return (
    <SheetScreen title={entry.dinner_name ?? t('common.dinnerFallback')}>
      <View style={styles.field}>
        <ThemedText type="smallBold">{t('entryEditor.servings')}</ThemedText>
        <Stepper value={servings} onChange={setServings} min={1} max={99} />
      </View>

      <View style={styles.actions}>
        <Button
          title={t('common.cancel')}
          variant="secondary"
          onPress={() => router.back()}
          style={styles.action}
        />
        <Button title={t('common.save')} onPress={save} style={styles.action} />
      </View>

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      <Button title={t('entryEditor.remove')} variant="danger" onPress={remove} />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
});
