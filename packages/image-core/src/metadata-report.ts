/**
 * Normalises exifr output for the metadata viewer (docs/10-METADATA.md §5.1). The parser is
 * allowed to return namespaces and raw rationals; this module decides which fields are useful,
 * labels them, and keeps the original value for the hover title.
 */
import type { HeaderMetadata, OrientationInfo } from './metadata.ts';

export type MetadataGroupId = 'camera' | 'capture' | 'image' | 'gps' | 'icc' | 'xmp' | 'iptc';

export type MetadataField = {
  label: string;
  value: string;
  /** The original value, shown on hover. */
  raw: string;
};

export type MetadataGroup = {
  id: MetadataGroupId;
  title: string;
  fields: MetadataField[];
  /** GPS is the one group the UI must mark as privacy-sensitive. */
  sensitive?: boolean;
};

export type MetadataReport = {
  name: string;
  bytes: number;
  format: string;
  mime: string;
  width: number | null;
  height: number | null;
  orientation: OrientationInfo | null;
  dpi: number | null;
  icc: { present: boolean | null; description: string | null };
  gps: { present: boolean; latitude: number | null; longitude: number | null };
  animated: boolean;
  groups: MetadataGroup[];
  warnings: string[];
};

export type MetadataRaw = Record<string, unknown>;

export type MetadataReportInput = {
  name: string;
  bytes: number;
  format: string;
  mime: string;
  width: number | null;
  height: number | null;
  raw: MetadataRaw | null;
  header: HeaderMetadata;
  animated?: boolean;
  warnings?: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) return null;
  return value as Record<string, unknown>;
}

function rawText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `${value.length} bytes`;
  if (Array.isArray(value)) return value.map(rawText).join(', ');
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, '');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19);
  if (value instanceof Uint8Array) return `${value.length} bytes`;
  if (Array.isArray(value)) return value.map(text).join(', ');
  if (record(value)) return rawText(value);
  return String(value);
}

function dateText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  return text(value);
}

function exposureText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return text(value);
  if (value >= 1) return `${Number(value.toFixed(2))} s`;
  return `1/${Math.round(1 / value)} s`;
}

function apertureText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return text(value);
  return `f/${Number(value.toFixed(2))}`;
}

function millimetresText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return text(value);
  return `${Number(value.toFixed(1))} mm`;
}

function isoText(value: unknown): string {
  return `ISO ${text(value)}`;
}

function resolutionText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return text(value);
  return `${Number(value.toFixed(1))} dpi`;
}

function colourSpaceText(value: unknown): string {
  if (value === 1 || value === '1') return 'sRGB';
  if (value === 0xffff || value === 65535) return 'Uncalibrated';
  return text(value);
}

function orientationText(value: unknown, header: HeaderMetadata): string {
  if (header.orientation) return header.orientation.effect;
  return text(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dms(value: unknown): number | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [degrees, minutes, seconds] = value;
  if (
    typeof degrees !== 'number' ||
    typeof minutes !== 'number' ||
    typeof seconds !== 'number' ||
    !Number.isFinite(degrees) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds)
  ) {
    return null;
  }
  return degrees + minutes / 60 + seconds / 3600;
}

function coordinate(gps: Record<string, unknown>, axis: 'lat' | 'lon'): number | null {
  const direct = finiteNumber(gps[axis === 'lat' ? 'latitude' : 'longitude']);
  if (direct !== null) return direct;
  const parts = dms(gps[axis === 'lat' ? 'GPSLatitude' : 'GPSLongitude']);
  if (parts === null) return null;
  const ref = gps[axis === 'lat' ? 'GPSLatitudeRef' : 'GPSLongitudeRef'];
  const negative = typeof ref === 'string' && (ref.toUpperCase() === 'S' || ref.toUpperCase() === 'W');
  return negative ? -parts : parts;
}

function coordinateText(value: number, axis: 'lat' | 'lon'): string {
  const hemisphere = axis === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E';
  return `${Math.abs(value).toFixed(5)}° ${hemisphere}`;
}

function altitudeText(value: unknown, ref: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return text(value);
  const below = ref === 1 || (record(ref) && record(ref)?.['0'] === 1);
  return `${Number(value.toFixed(1))} m ${below ? 'below sea level' : 'above sea level'}`;
}

function timestampText(date: unknown, time: unknown): string {
  const day = typeof date === 'string' ? date.replace(/:/g, '-') : null;
  if (Array.isArray(time) && time.length >= 3) {
    const [hours, minutes, seconds] = time;
    if (typeof hours === 'number' && typeof minutes === 'number' && typeof seconds === 'number') {
      const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
      return day ? `${day} ${clock} UTC` : `${clock} UTC`;
    }
  }
  if (typeof time === 'string') return day ? `${day} ${time} UTC` : `${time} UTC`;
  return day ?? text(time);
}

function addField(
  fields: MetadataField[],
  label: string,
  value: unknown,
  format?: (value: unknown) => string,
): void {
  if (value === undefined || value === null || value === '') return;
  const shown = format ? format(value) : text(value);
  if (!shown) return;
  fields.push({ label, value: shown, raw: rawText(value) });
}

function group(
  id: MetadataGroupId,
  title: string,
  fields: MetadataField[],
  sensitive = false,
): MetadataGroup | null {
  if (fields.length === 0) return null;
  return { id, title, fields, ...(sensitive ? { sensitive: true } : {}) };
}

function cameraGroup(raw: MetadataRaw): MetadataGroup | null {
  const ifd0 = record(raw.ifd0) ?? {};
  const exif = record(raw.exif) ?? {};
  const fields: MetadataField[] = [];
  addField(fields, 'Make', ifd0.Make);
  addField(fields, 'Model', ifd0.Model);
  addField(fields, 'Lens make', exif.LensMake);
  addField(fields, 'Lens model', exif.LensModel);
  addField(fields, 'Lens specification', exif.LensInfo);
  addField(fields, 'Aperture', exif.FNumber, apertureText);
  addField(fields, 'Shutter', exif.ExposureTime, exposureText);
  addField(fields, 'ISO', exif.ISO ?? exif.ISOSpeedRatings, isoText);
  addField(fields, 'Focal length', exif.FocalLength, millimetresText);
  addField(fields, '35 mm equivalent', exif.FocalLengthIn35mmFormat, millimetresText);
  addField(fields, 'Flash', exif.Flash);
  addField(fields, 'Metering', exif.MeteringMode);
  addField(fields, 'Exposure program', exif.ExposureProgram);
  addField(fields, 'White balance', exif.WhiteBalance);
  addField(fields, 'Exposure compensation', exif.ExposureCompensation);
  if (raw.makerNote !== undefined) {
    addField(fields, 'Maker note', raw.makerNote);
  } else if (exif.MakerNote !== undefined) {
    addField(fields, 'Maker note', exif.MakerNote);
  }
  return group('camera', 'Camera', fields);
}

function captureGroup(raw: MetadataRaw): MetadataGroup | null {
  const ifd0 = record(raw.ifd0) ?? {};
  const exif = record(raw.exif) ?? {};
  const fields: MetadataField[] = [];
  addField(fields, 'Captured', exif.DateTimeOriginal ?? ifd0.DateTime, dateText);
  addField(fields, 'Captured offset', exif.OffsetTimeOriginal ?? exif.OffsetTime, text);
  addField(fields, 'Sub-second', exif.SubSecTimeOriginal ?? exif.SubSecTime, text);
  addField(fields, 'Digitised', exif.DateTimeDigitized, dateText);
  addField(fields, 'Modified', ifd0.ModifyDate ?? ifd0.DateTime, dateText);
  addField(fields, 'Software', ifd0.Software, text);
  addField(fields, 'Artist', ifd0.Artist, text);
  addField(fields, 'Copyright', ifd0.Copyright, text);
  return group('capture', 'Capture', fields);
}

function imageGroup(raw: MetadataRaw, header: HeaderMetadata): MetadataGroup | null {
  const ifd0 = record(raw.ifd0) ?? {};
  const exif = record(raw.exif) ?? {};
  const fields: MetadataField[] = [];
  addField(fields, 'Description', ifd0.ImageDescription, text);
  addField(
    fields,
    'Dimensions',
    header.width && header.height ? `${header.width} × ${header.height}` : null,
    text,
  );
  addField(fields, 'Orientation', ifd0.Orientation, (value) => orientationText(value, header));
  addField(fields, 'Resolution', header.dpi, resolutionText);
  addField(fields, 'X resolution', ifd0.XResolution, resolutionText);
  addField(fields, 'Y resolution', ifd0.YResolution, resolutionText);
  addField(fields, 'Resolution unit', ifd0.ResolutionUnit, text);
  addField(fields, 'Colour space', exif.ColorSpace ?? ifd0.ColorSpace, colourSpaceText);
  addField(fields, 'Bits per sample', ifd0.BitsPerSample, text);
  addField(fields, 'Stored width', exif.ExifImageWidth ?? ifd0.ImageWidth, text);
  addField(fields, 'Stored height', exif.ExifImageHeight ?? ifd0.ImageHeight, text);
  return group('image', 'Image', fields);
}

function gpsGroup(raw: MetadataRaw): MetadataGroup | null {
  const gps = record(raw.gps);
  if (!gps) return null;
  const latitude = coordinate(gps, 'lat');
  const longitude = coordinate(gps, 'lon');
  const fields: MetadataField[] = [];
  if (latitude !== null)
    addField(fields, 'Latitude', latitude, (value) => coordinateText(value as number, 'lat'));
  if (longitude !== null)
    addField(fields, 'Longitude', longitude, (value) => coordinateText(value as number, 'lon'));
  addField(fields, 'Altitude', gps.GPSAltitude, (value) => altitudeText(value, gps.GPSAltitudeRef));
  addField(fields, 'GPS timestamp', timestampText(gps.GPSDateStamp, gps.GPSTimeStamp));
  addField(
    fields,
    'Direction',
    gps.GPSImgDirection,
    (value) => `${text(value)}° ${text(gps.GPSImgDirectionRef)}`,
  );
  addField(fields, 'Speed', gps.GPSSpeed, text);
  addField(fields, 'Speed unit', gps.GPSSpeedRef, text);
  addField(fields, 'Datum', gps.GPSMapDatum, text);
  return group('gps', 'Location (GPS)', fields, true);
}

function iccGroup(raw: MetadataRaw): MetadataGroup | null {
  const icc = record(raw.icc);
  if (!icc) return null;
  const fields: MetadataField[] = [];
  addField(fields, 'Description', icc.ProfileDescription, text);
  addField(fields, 'Colour space', icc.ColorSpaceData, text);
  addField(fields, 'Profile class', icc.ProfileClass, text);
  addField(fields, 'Version', icc.ProfileVersion, text);
  addField(fields, 'Copyright', icc.ProfileCopyright, text);
  addField(fields, 'Rendering intent', icc.RenderingIntent, text);
  return group('icc', 'ICC colour profile', fields);
}

const XMP_NAMESPACES = [
  'dc',
  'xmp',
  'photoshop',
  'xmpMM',
  'crs',
  'aux',
  'GPano',
  'Iptc4xmpCore',
  'plus',
  'lr',
  'pdf',
] as const;

function localizedText(value: unknown): string {
  const localized = record(value);
  return localized && 'value' in localized ? text(localized.value) : text(value);
}

function xmpGroup(raw: MetadataRaw): MetadataGroup | null {
  const xmp: Record<string, unknown> = {};
  for (const namespace of XMP_NAMESPACES) {
    Object.assign(xmp, record(raw[namespace]) ?? {});
  }
  if (Object.keys(xmp).length === 0) return null;
  const fields: MetadataField[] = [];
  addField(fields, 'Title', xmp.Title ?? xmp.title, localizedText);
  addField(fields, 'Description', xmp.Description ?? xmp.description, localizedText);
  addField(fields, 'Creator', xmp.Creator ?? xmp.creator, localizedText);
  addField(fields, 'Rights', xmp.Rights ?? xmp.rights, localizedText);
  addField(fields, 'Keywords', xmp.Subject ?? xmp.subject ?? xmp.Keywords ?? xmp.keywords, text);
  addField(fields, 'Creator tool', xmp.CreatorTool, text);
  addField(fields, 'City', xmp.City, text);
  addField(fields, 'Country', xmp.Country, text);
  return group('xmp', 'XMP', fields);
}

function iptcGroup(raw: MetadataRaw): MetadataGroup | null {
  const iptc = record(raw.iptc);
  if (!iptc) return null;
  const fields: MetadataField[] = [];
  addField(fields, 'Caption', iptc.Caption ?? iptc.Description, text);
  addField(fields, 'Headline', iptc.Headline, text);
  addField(fields, 'Keywords', iptc.Keywords, text);
  addField(fields, 'Creator', iptc.Byline ?? iptc.Creator, text);
  addField(fields, 'Copyright', iptc.CopyrightNotice ?? iptc.Copyright, text);
  addField(fields, 'City', iptc.City, text);
  addField(fields, 'Country', iptc.Country, text);
  return group('iptc', 'IPTC', fields);
}

function rawResolution(ifd0: Record<string, unknown> | null): number | null {
  const x = finiteNumber(ifd0?.XResolution);
  const y = finiteNumber(ifd0?.YResolution);
  const unit = ifd0?.ResolutionUnit;
  const value = x ?? y;
  if (value === null) return null;
  if (unit === 'centimeters' || unit === 3) return Math.round(value * 2.54 * 10) / 10;
  return Math.round(value * 10) / 10;
}

function iccPresence(raw: MetadataRaw | null, header: HeaderMetadata): boolean | null {
  if (raw && record(raw.icc)) return true;
  return header.icc;
}

/** Builds the grouped, human-readable report; never throws on a strange tag value. */
export function buildMetadataReport(input: MetadataReportInput): MetadataReport {
  const raw = input.raw;
  const ifd0 = raw ? record(raw.ifd0) : null;
  const gps = raw ? record(raw.gps) : null;
  const latitude = gps ? coordinate(gps, 'lat') : null;
  const longitude = gps ? coordinate(gps, 'lon') : null;
  const icc = raw ? record(raw.icc) : null;
  const dpi = input.header.dpi ?? rawResolution(ifd0);
  const groups = [
    raw ? cameraGroup(raw) : null,
    raw ? captureGroup(raw) : null,
    imageGroup(raw ?? {}, input.header),
    raw ? gpsGroup(raw) : null,
    raw ? iccGroup(raw) : null,
    raw ? xmpGroup(raw) : null,
    raw ? iptcGroup(raw) : null,
  ].filter((value): value is MetadataGroup => value !== null);

  const warnings = [...(input.warnings ?? [])];
  if (input.animated) warnings.push('Animated file: tags shown are from the first frame.');
  if (!raw) {
    warnings.push('The full metadata parser could not read this file; the header summary is shown.');
  }
  if (input.format === 'heic' && groups.length === 0) {
    warnings.push('HEIC metadata is not readable without the HEIC decoder.');
  } else if (raw && groups.length === 0) {
    warnings.push('No EXIF, XMP, IPTC or ICC metadata was found in the first 256 KB.');
  }
  if (raw && Array.isArray(raw.errors) && raw.errors.length > 0) {
    warnings.push(
      `The parser reported ${raw.errors.length} metadata warning${raw.errors.length === 1 ? '' : 's'}.`,
    );
  }

  return {
    name: input.name,
    bytes: input.bytes,
    format: input.format,
    mime: input.mime,
    width: input.width ?? input.header.width,
    height: input.height ?? input.header.height,
    orientation: input.header.orientation,
    dpi,
    icc: {
      present: iccPresence(raw, input.header),
      description: icc && typeof icc.ProfileDescription === 'string' ? icc.ProfileDescription : null,
    },
    gps: {
      present: latitude !== null && longitude !== null,
      latitude,
      longitude,
    },
    animated: input.animated ?? false,
    groups,
    warnings,
  };
}
