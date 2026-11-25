import { Text, type TextProps } from 'react-native'
import { DENSE_FONT_SCALE } from '@/lib/denseType'

export function DenseText({ style, ...rest }: TextProps) {
  return <Text {...rest} maxFontSizeMultiplier={DENSE_FONT_SCALE} style={style} />
}
