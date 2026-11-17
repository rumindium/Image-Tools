import { bytesToBase64, wrapBase64 } from '@ri/image-core';

/**
 * The text half of Base64 encode. It runs off the main thread because a 30 MB image becomes 40 MB
 * of characters; `FileReader` is async but its conversion still competes with painting. The actual
 * byte → base64 step is chunked in image-core, never `String.fromCharCode(...wholeFile)`.
 */

type Request = {
  id: string;
  blob: Blob;
  mime: string;
  includeDataUri: boolean;
  lineWrap: number;
};

type Response = { id: string; text?: string; error?: string };

type WorkerScope = {
  postMessage: (message: Response) => void;
  onmessage: ((event: MessageEvent<Request>) => void) | null;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = async (event) => {
  const { id, blob, mime, includeDataUri, lineWrap } = event.data;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const payload = bytesToBase64(bytes);
    const raw = includeDataUri ? `data:${mime};base64,${payload}` : payload;
    scope.postMessage({ id, text: wrapBase64(raw, lineWrap) });
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : 'The image could not be encoded as text.',
    });
  }
};
