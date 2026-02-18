import { type Request, type Response, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { supabase, STORAGE_BUCKET } from '../services/supabase.js';
import { runVision, runRanking } from '../services/openai.js';
import { renderVisionOverlay } from '../services/overlay.js';

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      cb(
        new ApiError(
          400,
          'UNSUPPORTED_IMAGE_TYPE',
          `Unsupported image type "${file.mimetype}". Use one of: ${Array.from(ALLOWED_IMAGE_TYPES).join(', ')}`
        )
      );
      return;
    }

    cb(null, true);
  }
});
export const analyzeRouter = Router();

const UserIdSchema = z.string().uuid();

function runUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('image')(req, res, err => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

async function uploadImage(file: Express.Multer.File): Promise<{ path: string; publicUrl: string }> {
  const ext = file.originalname.split('.').pop() || 'jpg';
  const path = `scans/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

  const publicUrl = await uploadStorageObject(path, file.buffer, file.mimetype, 'STORAGE_UPLOAD_FAILED');
  return { path, publicUrl };
}

async function uploadStorageObject(
  path: string,
  buffer: Buffer,
  contentType: string,
  errorCode: string
): Promise<string> {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType });

  if (error) {
    throw new ApiError(502, errorCode, `Storage upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function cleanupImage(path: string): Promise<void> {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) {
    throw new Error(`Image cleanup failed: ${error.message}`);
  }
}

async function cleanupScan(scanId: string): Promise<void> {
  const { error } = await supabase.from('scans').delete().eq('id', scanId);
  if (error) {
    throw new Error(`Scan cleanup failed: ${error.message}`);
  }
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new ApiError(
        413,
        'IMAGE_TOO_LARGE',
        `Image exceeds limit of ${Math.floor(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))}MB`
      );
    }

    return new ApiError(400, 'UPLOAD_ERROR', error.message);
  }

  return new ApiError(500, 'INTERNAL_ERROR', 'Internal error');
}

analyzeRouter.post('/overlay', async (req, res) => {
  let overlayPath: string | null = null;

  try {
    await runUpload(req, res);
    if (!req.file) {
      throw new ApiError(400, 'MISSING_IMAGE', 'Missing image file field "image"');
    }

    const vision = await runVision({
      imageUrl: 'debug-overlay-upload',
      mimeType: req.file.mimetype,
      buffer: req.file.buffer
    });

    const overlayBuffer = await renderVisionOverlay(req.file.buffer, vision.candidates);
    overlayPath = `overlays/${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
    const overlayImageUrl = await uploadStorageObject(overlayPath, overlayBuffer, 'image/png', 'OVERLAY_UPLOAD_FAILED');

    const localized = vision.candidates.filter(candidate => candidate.bbox !== null).length;
    return res.json({
      overlay_image_url: overlayImageUrl,
      vision,
      bbox_summary: {
        total_candidates: vision.candidates.length,
        localized_candidates: localized,
        missing_bbox: vision.candidates.length - localized
      }
    });
  } catch (error: unknown) {
    if (overlayPath) {
      try {
        await cleanupImage(overlayPath);
      } catch (cleanupErr) {
        console.error(cleanupErr);
      }
    }

    const apiError = toApiError(error);
    return res.status(apiError.status).json({
      error: {
        code: apiError.code,
        message: apiError.message
      }
    });
  }
});

analyzeRouter.post('/', async (req, res) => {
  let uploadedPath: string | null = null;
  let scanId: string | null = null;

  try {
    const userIdRaw = Array.isArray(req.query.user_id) ? req.query.user_id[0] : req.query.user_id;
    const userId = UserIdSchema.safeParse(String(userIdRaw || ''));
    if (!userId.success) {
      throw new ApiError(400, 'INVALID_USER_ID', 'Invalid user_id query parameter');
    }
    const userIdValue = userId.data;

    await runUpload(req, res);
    if (!req.file) {
      throw new ApiError(400, 'MISSING_IMAGE', 'Missing image file field "image"');
    }

    const uploadedImage = await uploadImage(req.file);
    uploadedPath = uploadedImage.path;
    const imageUrl = uploadedImage.publicUrl;

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('arch_type, usage, weekly_mileage')
      .eq('id', userIdValue)
      .single();

    if (userErr || !user) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const { data: scan, error: scanErr } = await supabase
      .from('scans')
      .insert({ user_id: userIdValue, image_url: imageUrl })
      .select('id')
      .single();

    if (scanErr || !scan) {
      throw new ApiError(500, 'SCAN_CREATE_FAILED', `Failed to create scan: ${scanErr?.message ?? 'unknown'}`);
    }
    scanId = scan.id;

    const vision = await runVision({
      imageUrl,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer
    });

    const visionFailed = vision.candidates.length === 0;

    const { data: shoes, error: shoesErr } = await supabase.from('shoes').select('*');
    if (shoesErr) {
      throw new ApiError(500, 'SHOES_LOAD_FAILED', `Failed to load shoes: ${shoesErr.message}`);
    }

    const specsByName: Record<string, unknown> = {};
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

    if (recErr) {
      throw new ApiError(500, 'RECOMMENDATIONS_SAVE_FAILED', `Failed to save recommendations: ${recErr.message}`);
    }

    return res.json({ scan_id: scan.id, image_url: imageUrl, vision, recommendations });
  } catch (error: unknown) {
    if (scanId) {
      try {
        await cleanupScan(scanId);
      } catch (cleanupErr) {
        console.error(cleanupErr);
      }
    }

    if (uploadedPath) {
      try {
        await cleanupImage(uploadedPath);
      } catch (cleanupErr) {
        console.error(cleanupErr);
      }
    }

    const apiError = toApiError(error);
    return res.status(apiError.status).json({
      error: {
        code: apiError.code,
        message: apiError.message
      }
    });
  }
});
