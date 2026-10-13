import { File, Paths } from 'expo-file-system'

/** Copy a recording out of cache into the app documents folder. The clip is not uploaded. */
export function keepClipOnDevice(uri: string, filename: string): string {
  const source = new File(uri)
  const dest = new File(Paths.document, filename)
  if (dest.exists) dest.delete()
  source.copySync(dest)
  return dest.uri
}
