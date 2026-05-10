// Verifies caller is admin, uploads file to Cloudflare R2 via S3-compatible API,
// then records the entry via admin_insert_uploaded_meme RPC.
//
// Required Edge Function secrets (set via Supabase Dashboard → Edge Functions → Secrets):
//   R2_ACCOUNT_ID         — Cloudflare account ID
//   R2_ACCESS_KEY_ID      — R2 API token Access Key ID
//   R2_SECRET_ACCESS_KEY  — R2 API token Secret Access Key
//   R2_BUCKET             — bucket name (e.g. "fuqmea-memes")
//   R2_PUBLIC_BASE        — public URL base (e.g. "https://memes.fuqmea.com")

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file

const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') || '';
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') || '';
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') || '';
const R2_BUCKET = Deno.env.get('R2_BUCKET') || 'fuqmea-memes';

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
    if (!user || role !== 'admin') {
      return json({ error: 'not authorized' }, 403);
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const displayNameRaw = formData.get('display_name');

    if (!(file instanceof File)) return json({ error: 'no file uploaded' }, 400);
    if (!ALLOWED_MIME.has(file.type)) {
      return json({ error: `unsupported type: ${file.type}` }, 400);
    }
    if (file.size === 0) return json({ error: 'empty file' }, 400);
    if (file.size > MAX_BYTES) return json({ error: 'file too large (max 25 MB)' }, 413);

    const displayName = typeof displayNameRaw === 'string' ? displayNameRaw.trim() : '';
    if (!displayName || displayName.length > 200) {
      return json({ error: 'display_name required (1-200 chars)' }, 400);
    }

    const ext = mimeToExt(file.type) || filenameExt(file.name) || 'bin';
    const uuid = crypto.randomUUID();
    const storageKey = `uploads/${uuid}.${ext}`;

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

    const { data: entry, error: insertErr } = await userClient.rpc('admin_insert_uploaded_meme', {
      p_storage_key: storageKey,
      p_display_name: displayName,
      p_extension: ext,
    });

    if (insertErr) {
      // Best-effort: clean up the orphaned R2 object since DB insert failed.
      r2.fetch(r2Url, { method: 'DELETE' }).catch(() => { /* swallow */ });
      console.error('DB insert failed', insertErr);
      return json({ error: insertErr.message || 'db insert failed' }, 500);
    }

    return json({ entry }, 200);
  } catch (e) {
    console.error('upload-meme error', e);
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
    default: return '';
  }
}

function filenameExt(name: string): string {
  const m = (name || '').match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}
