import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { supabase, STORAGE_BUCKET } from '../services/supabase.js';
import { runVision, runRanking } from '../services/openai.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
export const analyzeRouter = Router();

const UserIdSchema = z.string().uuid();

async function uploadImage(file: Express.Multer.File): Promise<string> {
  const ext = file.originalname.split('.').pop() || 'jpg';
  const path = `scans/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

analyzeRouter.post('/', upload.single('image'), async (req, res) => {
  try {
    const userIdRaw = Array.isArray(req.query.user_id)
      ? req.query.user_id[0]
      : req.query.user_id;

    const userId = UserIdSchema.safeParse(String(userIdRaw || ''));
    if (!userId.success) {
      return res.status(400).json({ error: 'Invalid user_id', received: req.query.user_id });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Missing image file field "image"' });
    }

    const userIdValue = userId.data;

    const imageUrl = await uploadImage(req.file);

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('arch_type, usage, weekly_mileage')
      .eq('id', userIdValue)
      .single();

    if (userErr || !user) return res.status(404).json({ error: 'User not found' });

    const { data: scan, error: scanErr } = await supabase
      .from('scans')
      .insert({ user_id: userIdValue, image_url: imageUrl })
      .select('id')
      .single();

    if (scanErr || !scan) throw new Error(`Failed to create scan: ${scanErr?.message}`);

    const vision = await runVision({
      imageUrl,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer
    });

    const visionFailed = vision.candidates.length === 0;

    const { data: shoes, error: shoesErr } = await supabase.from('shoes').select('*');
    if (shoesErr) throw new Error(`Failed to load shoes: ${shoesErr.message}`);

    const specsByName: Record<string, any> = {};
    for (const s of shoes || []) specsByName[`${s.brand} ${s.model}`] = s;

    const recommendations = await runRanking({
      requestId: vision.request_id,
      profile: user,
      candidates: vision.candidates,
      specsByName,
      visionFailed
    });

    const { error: recErr } = await supabase.from('recommendations').insert({
      scan_id: scan.id,
      ranked: recommendations.ranked,
      avoid: recommendations.avoid,
      fallback_needed: recommendations.fallback_needed
    });

    if (recErr) throw new Error(`Failed to save recommendations: ${recErr.message}`);

    return res.json({ scan_id: scan.id, image_url: imageUrl, vision, recommendations });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

