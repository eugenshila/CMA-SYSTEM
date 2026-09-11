import 'server-only';

import { getSetting } from './settings';

export type MinutesOcrStatus = 'completed' | 'needs_review' | 'not_configured' | 'failed';

export type MinutesOcrResult = {
  status: MinutesOcrStatus;
  text: string;
  provider: string | null;
  error?: string | null;
};

/**
 * Read a scanned minutes page with an optional OCR provider.
 *
 * Providers:
 * - Google Cloud Vision: image JPEG/PNG/WebP/GIF. Set provider to
 *   `google_vision` and an API key in Settings → Minutes OCR.
 * - Generic: POSTs multipart/form-data (`file`, `purpose=meeting_minutes`) to
 *   the configured URL and accepts `{ text }`, `{ data: { text } }`, or
 *   `{ result: { text } }`. This makes it possible to use an on-premise OCR
 *   service where the parish must keep scans within its own infrastructure.
 *
 * OCR is never treated as official minutes: the secretary reviews and saves the
 * extracted draft before publishing it.
 */
export async function recogniseMeetingMinutes(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<MinutesOcrResult> {
  if (input.mimeType === 'text/plain' || /\.txt$/i.test(input.fileName)) {
    return {
      status: 'needs_review',
      text: input.buffer.toString('utf8').trim(),
      provider: 'plain_text',
    };
  }

  const settings = await getSetting<any>('minutes_ocr');
  const provider = String(settings.provider || 'none').trim().toLowerCase();
  const apiUrl = String(settings.api_url || '').trim();
  const apiKey = String(settings.api_key || '').trim();

  if (!provider || provider === 'none') {
    return {
      status: 'not_configured',
      text: '',
      provider: null,
      error: 'OCR is not configured. The scan was saved; enter or paste the reviewed minutes below.',
    };
  }

  try {
    if (provider === 'google_vision') {
      if (!apiKey) {
        return { status: 'not_configured', text: '', provider, error: 'Add a Google Cloud Vision API key in Settings → Minutes OCR.' };
      }
      if (!input.mimeType.startsWith('image/')) {
        return {
          status: 'needs_review',
          text: '',
          provider,
          error: 'Google Cloud Vision OCR accepts images here. The PDF scan was saved; upload page images or enter the minutes manually.',
        };
      }
      const endpoint = apiUrl || `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: input.buffer.toString('base64') },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `Google Vision responded ${response.status}`);
      const text = String(data?.responses?.[0]?.fullTextAnnotation?.text || data?.responses?.[0]?.textAnnotations?.[0]?.description || '').trim();
      return text
        ? { status: 'needs_review', text, provider }
        : { status: 'needs_review', text: '', provider, error: 'No legible text was found. Please type or paste the minutes.' };
    }

    if (provider === 'generic') {
      if (!apiUrl) {
        return { status: 'not_configured', text: '', provider, error: 'Add the generic OCR endpoint URL in Settings → Minutes OCR.' };
      }
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(input.buffer)], { type: input.mimeType || 'application/octet-stream' }), input.fileName);
      form.append('purpose', 'meeting_minutes');
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        body: form,
        signal: AbortSignal.timeout(90_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || data?.message || `OCR service responded ${response.status}`);
      const text = String(data?.text || data?.data?.text || data?.result?.text || '').trim();
      return text
        ? { status: 'needs_review', text, provider }
        : { status: 'needs_review', text: '', provider, error: 'The OCR service returned no text. Please type or paste the minutes.' };
    }

    return { status: 'not_configured', text: '', provider, error: `Unsupported OCR provider “${provider}”.` };
  } catch (error: any) {
    return {
      status: 'failed',
      text: '',
      provider,
      error: error?.message || 'The OCR service could not read this scan.',
    };
  }
}
