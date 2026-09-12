import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSyncRefresh } from '@/hooks/use-sync-refresh';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { createDinner, useDinners, type DinnerWithItems } from '@/lib/store';

/**
 * The recipe list. A virtualised `FlatList` rather than the shared `Screen`
 * ScrollView: this is the one list that grows without bound (every recipe the
 * household ever saved), so rows are mounted on demand instead of all at once.
 */
export default function DinnersScreen() {
  const t = useT();
  const dinners = useDinners();
  const { refreshing, onRefresh } = useSyncRefresh();

  function openDinner(id: string) {
    router.push({ pathname: '/dinners/[id]', params: { id } });
  }

  return (
    <ThemedView style={styles.flex}>
      <FlatList
        data={dinners}
        keyExtractor={(dinner) => dinner.id}
        renderItem={({ item, index }) => (
          <DinnerRow
            dinner={item}
            first={index === 0}
            last={index === dinners.length - 1}
            onPress={openDinner}
          />
        )}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<NewDinnerCard />}
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary">{t('dinners.empty')}</ThemedText>
        }
        // Rows render as one continuous card: the list itself carries the card
        // surface, and each row draws its own divider.
        style={styles.flex}
      />
    </ThemedView>
  );
}

/**
 * The "new dinner" form owns its own draft state, so a keystroke re-renders
 * this card only — not the list owner above it and every mounted row with it.
 */
function NewDinnerCard() {
  const t = useT();
  const [name, setName] = useState('');
  // Guards against a keyboard "done" + button tap both firing one create; reset
  // when the user starts typing the next name (the field is always visible here).
  const submitted = useRef(false);

  function onCreate() {
    const trimmed = name.trim();
    if (!trimmed || submitted.current) {
      return;
    }
    submitted.current = true;
    const id = createDinner({ name: trimmed });
    setName('');
    router.push({ pathname: '/dinners/[id]', params: { id } });
  }

  return (
    <View style={styles.header}>
      <Card>
        <ThemedText type="smallBold">{t('dinners.newDinner')}</ThemedText>
        <TextField
          label={t('dinners.name')}
          placeholder={t('dinners.namePlaceholder')}
          value={name}
          onChangeText={(text) => {
            submitted.current = false;
            setName(text);
          }}
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={onCreate}
        />
        <Button title={t('dinners.createAndAdd')} onPress={onCreate} disabled={!name.trim()} />
      </Card>
    </View>
  );
}

type DinnerRowProps = {
  dinner: DinnerWithItems;
  first: boolean;
  last: boolean;
  onPress: (id: string) => void;
};

function DinnerRow({ dinner, first, last, onPress }: DinnerRowProps) {
  const t = useT();
  const theme = useTheme();
  const count = dinner.items.length;
  return (
    <Pressable
      onPress={() => onPress(dinner.id)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.backgroundElement },
        first && styles.rowFirst,
        last && styles.rowLast,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        pressed && styles.pressed,
      ]}>
      <View style={styles.rowText}>
        <ThemedText numberOfLines={1}>{dinner.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {dinner.default_servings} {t('common.servings')} · {count}{' '}
          {count === 1 ? t('common.ingredient') : t('common.ingredients')}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        ›
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.five,
  },
  header: {
    marginBottom: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowFirst: {
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
  },
  rowLast: {
    borderBottomLeftRadius: Spacing.three,
    borderBottomRightRadius: Spacing.three,
  },
  rowText: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
