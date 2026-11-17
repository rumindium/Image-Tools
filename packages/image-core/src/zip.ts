import { dedupeNames, isSafeName } from './naming.ts';

/**
 * The archive *manifest*, not the archive: `fflate` in the browser and `archiver` on the server
 * both consume this (docs/13-EXPORT-MANAGER.md §4). Keeping it here is what makes the two writers
 * produce identical entry names and order.
 */
export type ZipEntry<T> = { name: string; item: T; bytes: number };

export type ZipManifest<T> = {
  entries: ZipEntry<T>[];
  totalBytes: number;
  storeOnly: boolean;
};

export function zipManifest<T>(
  outputs: ReadonlyArray<{ name: string; item: T; bytes: number }>,
  options: { storeAboveBytes?: number } = {},
): ZipManifest<T> {
  const names = dedupeNames(outputs.map((output) => output.name));
  const unsafe = names.filter((name) => !isSafeName(name));
  if (unsafe.length > 0) {
    throw new Error(`Refusing to build an archive with unsafe entry names: ${unsafe.join(', ')}`);
  }

  const entries = outputs.map((output, index) => ({
    name: names[index] as string,
    item: output.item,
    bytes: output.bytes,
  }));

  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const storeAboveBytes = options.storeAboveBytes ?? 268_435_456;

  return { entries, totalBytes, storeOnly: totalBytes > storeAboveBytes };
}
