import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import type { PlanEntryWithDinner } from '@/lib/store';

export type EntryEdit = { servings: number };

type EntryEditorProps = {
  entry: PlanEntryWithDinner | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (entry: PlanEntryWithDinner, edit: EntryEdit) => void;
  onRemove: (entry: PlanEntryWithDinner) => void;
};

/** Edit a scheduled dinner: change its servings or remove it. Moving it to
 * another day is done by dragging the card on the week board. */
export function EntryEditor({ entry, busy, onClose, onSave, onRemove }: EntryEditorProps) {
  return (
    <BottomSheet visible={!!entry} onClose={onClose} contentGap={Spacing.four}>
      {entry ? (
        <EntryEditorForm
          key={entry.id}
          entry={entry}
          busy={busy}
          onClose={onClose}
          onSave={onSave}
          onRemove={onRemove}
        />
      ) : null}
    </BottomSheet>
  );
}

function EntryEditorForm({
  entry,
  busy,
  onClose,
  onSave,
  onRemove,
}: {
  entry: PlanEntryWithDinner;
  busy?: boolean;
  onClose: () => void;
  onSave: (entry: PlanEntryWithDinner, edit: EntryEdit) => void;
  onRemove: (entry: PlanEntryWithDinner) => void;
}) {
  const t = useT();
  const [servings, setServings] = useState(entry.servings);

  return (
    <>
      <ThemedText type="subtitle" numberOfLines={1}>
        {entry.dinner_name ?? t('common.dinnerFallback')}
      </ThemedText>

      <View style={styles.field}>
        <ThemedText type="smallBold">{t('entryEditor.servings')}</ThemedText>
        <View style={styles.stepper}>
          <Stepper label="−" onPress={() => setServings((s) => Math.max(1, s - 1))} />
          <ThemedText type="subtitle" style={styles.stepperValue}>
            {servings}
          </ThemedText>
          <Stepper label="＋" onPress={() => setServings((s) => s + 1)} />
        </View>
      </View>

      <Button title={t('common.save')} onPress={() => onSave(entry, { servings })} loading={busy} />
      <View style={styles.footer}>
        <Button title={t('common.remove')} variant="secondary" style={styles.flex} onPress={() => onRemove(entry)} />
        <Button title={t('common.cancel')} variant="secondary" style={styles.flex} onPress={onClose} />
      </View>
    </>
  );
}

function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundSelected" style={styles.stepperButton}>
        <ThemedText type="subtitle" style={styles.stepperButtonText}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
  },
  stepperValue: {
    minWidth: 40,
    textAlign: 'center',
  },
  stepperButton: {
    width: 48,
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: {
    lineHeight: 30,
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  flex: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
