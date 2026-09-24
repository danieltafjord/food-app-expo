import { SymbolView, type SymbolWeight } from 'expo-symbols';
import { Platform, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

/**
 * SF Symbols used across the app, with the Material Symbols equivalent that
 * Android and web render. Only names listed here can be used, so every glyph
 * in the app has a counterpart on each platform.
 */
const ICONS = {
  plus: 'add',
  minus: 'remove',
  checkmark: 'check',
  'chevron.left': 'chevron_left',
  'chevron.right': 'chevron_right',
  'arrow.uturn.backward': 'undo',
  cart: 'shopping_cart',
  'fork.knife': 'restaurant',
  'list.bullet': 'list',
  sparkles: 'auto_awesome',
  camera: 'photo_camera',
  'photo.on.rectangle': 'photo_library',
  trash: 'delete',
  archivebox: 'inventory_2',
  pencil: 'edit',
  'exclamationmark.triangle.fill': 'warning',
} as const;

export type IconName = keyof typeof ICONS;

type IconProps = {
  name: IconName;
  size?: number;
  color: ColorValue;
  weight?: SymbolWeight;
  style?: StyleProp<ViewStyle>;
};

/** A monochrome system symbol, tinted with a theme colour. Decorative: hidden from VoiceOver. */
export function Icon({ name, size = 17, color, weight = 'semibold', style }: IconProps) {
  const material = ICONS[name];
  return (
    <SymbolView
      name={{ ios: name, android: material, web: material }}
      size={size}
      tintColor={color}
      // Android and web take weights as imported font assets; keep their default.
      weight={Platform.OS === 'ios' ? weight : undefined}
      type="monochrome"
      style={style}
      accessible={false}
    />
  );
}
