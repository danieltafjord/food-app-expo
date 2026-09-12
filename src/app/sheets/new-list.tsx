import { router } from 'expo-router';
import { useRef, useState } from 'react';

import { Button } from '@/components/button';
import { SheetScreen } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { useT } from '@/lib/i18n';
import { createShoppingList } from '@/lib/store';

/** Name and create a shopping list, then open it. */
export default function NewListSheet() {
  const t = useT();
  const [name, setName] = useState('');
  // Latches the create so a keyboard "done" + button tap in the same beat can't
  // create (and navigate into) two lists.
  const submitted = useRef(false);

  function onCreate() {
    const trimmed = name.trim();
    if (!trimmed || submitted.current) return;
    submitted.current = true;
    const id = createShoppingList(trimmed);
    router.back();
    router.push({ pathname: '/shopping/[id]', params: { id } });
  }

  return (
    <SheetScreen title={t('shopping.newList')}>
      <TextField
        label={t('shopping.name')}
        placeholder={t('shopping.namePlaceholder')}
        value={name}
        onChangeText={setName}
        autoCapitalize="sentences"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={onCreate}
      />
      <Button title={t('shopping.createList')} onPress={onCreate} disabled={!name.trim()} />
    </SheetScreen>
  );
}
