// Deletes an uploaded meme: removes the DB row (admin RPC returns the storage_key)
// and then deletes the underlying object from Cloudflare R2.
//
// Static memes can't be deleted here — admin should toggle hidden=true instead.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

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

    let body: { id?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    const id = (body?.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return json({ error: 'invalid id' }, 400);
    }

    const { data: storageKey, error: rpcErr } = await userClient.rpc('admin_delete_uploaded_meme', {
      p_id: id,
    });
    if (rpcErr) {
      return json({ error: rpcErr.message || 'delete failed' }, 400);
    }
    if (!storageKey || typeof storageKey !== 'string') {
      return json({ error: 'invalid storage_key' }, 500);
    }

    const r2Url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${storageKey}`;
    const delResp = await r2.fetch(r2Url, { method: 'DELETE' });
    // R2 returns 204 on success; 404 means already gone (still OK).
    if (!delResp.ok && delResp.status !== 404) {
      const detail = await delResp.text().catch(() => '');
      console.error('R2 delete failed', delResp.status, detail);
      // DB row is gone; surface a soft warning rather than failing.
      return json({ ok: true, warning: 'object may still exist in storage' }, 200);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error('delete-meme error', e);
    return json({ error: 'internal error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
