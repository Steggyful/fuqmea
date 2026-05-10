// Verifies caller has 'admin' or 'vivid' role, uploads file to Cloudflare R2
// under the `fifi/` prefix, and returns its public URL. The caller (vivid
// admin panel) writes the URL into fifi_zone_settings via set_fifi_zone_settings.
//
// Required Edge Function secrets (Supabase Dashboard → Edge Functions → Secrets):
//   R2_ACCOUNT_ID         — Cloudflare account ID
//   R2_ACCESS_KEY_ID      — R2 API token Access Key ID
//   R2_SECRET_ACCESS_KEY  — R2 API token Secret Access Key
//   R2_BUCKET             — bucket name (shared with memes; e.g. "fuqmea-memes")
//   R2_PUBLIC_BASE        — public URL base (e.g. "https://memes.fuqmea.com")

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const ALLOWED_AUDIO_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
]);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;  // 25 MB
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;  // 50 MB — songs can be larger

const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') || '';
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') || '';
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') || '';
const R2_BUCKET = Deno.env.get('R2_BUCKET') || 'fuqmea-memes';
const R2_PUBLIC_BASE = (Deno.env.get('R2_PUBLIC_BASE') || 'https://memes.fuqmea.com').replace(/\/+$/, '');

const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto',
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return json({ error: 'r2 not configured' }, 500);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'missing auth' }, 401);
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    const { data: { user } } = await userClient.auth.getUser();
    const role = (user?.app_metadata as { role?: string } | undefined)?.role;
    if (!user || (role !== 'admin' && role !== 'vivid')) {
      return json({ error: 'not authorized' }, 403);
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const kindRaw = formData.get('kind');

    if (!(file instanceof File)) return json({ error: 'no file uploaded' }, 400);

    const kind = typeof kindRaw === 'string' ? kindRaw : '';
    if (kind !== 'image' && kind !== 'audio') {
      return json({ error: 'kind must be "image" or "audio"' }, 400);
    }

    const allowed = kind === 'image' ? ALLOWED_IMAGE_MIME : ALLOWED_AUDIO_MIME;
    const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;

    if (!allowed.has(file.type)) {
      return json({ error: `unsupported ${kind} type: ${file.type}` }, 400);
    }
    if (file.size === 0) return json({ error: 'empty file' }, 400);
    if (file.size > maxBytes) {
      return json({ error: `file too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)` }, 413);
    }

    const ext = mimeToExt(file.type) || filenameExt(file.name) || (kind === 'image' ? 'bin' : 'mp3');
    const uuid = crypto.randomUUID();
    const storageKey = `fifi/${kind}/${uuid}.${ext}`;

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const r2Url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${storageKey}`;

    const putResp = await r2.fetch(r2Url, {
      method: 'PUT',
      body: fileBytes,
      headers: { 'Content-Type': file.type },
    });
    if (!putResp.ok) {
      const detail = await putResp.text().catch(() => '');
      console.error('R2 upload failed', putResp.status, detail);
      return json({ error: 'storage upload failed' }, 502);
    }

    const publicUrl = `${R2_PUBLIC_BASE}/${storageKey}`;
    return json({ url: publicUrl, storage_key: storageKey, kind }, 200);
  } catch (e) {
    console.error('upload-fifi-asset error', e);
    return json({ error: 'internal error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png':  return 'png';
    case 'image/gif':  return 'gif';
    case 'image/webp': return 'webp';
    case 'audio/mpeg':
    case 'audio/mp3':  return 'mp3';
    case 'audio/ogg':  return 'ogg';
    case 'audio/wav':
    case 'audio/x-wav': return 'wav';
    case 'audio/mp4':
    case 'audio/x-m4a': return 'm4a';
    case 'audio/aac':  return 'aac';
    default: return '';
  }
}

function filenameExt(name: string): string {
  const m = (name || '').match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}
