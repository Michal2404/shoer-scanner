import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { z } from 'zod'
import type {
  VisionResult,
  RecommendationsResult,
  ArchType,
  Usage
} from '../types/contracts.js';

const MOCK_VISION = (process.env.MOCK_VISION || 'true').toLowerCase() === 'true';
const MOCK_RANKING = (process.env.MOCK_VISION || 'true').toLowerCase() === 'true';

const apiKey = process.env.OPENAI_API_KEY || '';
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export const openai = apiKey ? new OpenAI({ apiKey }) : null;

/**
 * Schemas: validate that the model returns exactly what our API expects.
 * This prevents malformed model output from breaking the pipeline.
 */
const VisionSchema = z.object({
  request_id: z.string(),
  candidates: z
    .array(
      z.object({
        raw_label: z.string(),
        brand: z.string().nullable(),
        model: z.string().nullable(),
        confidence: z.number().min(0).max(1),
        bbox: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            w: z.number().min(0).max(1),
            h: z.number().min(0).max(1)
          })
          .nullable()
          .optional(),
        notes: z.string().nullable().optional()
      })
    )
    .max(8),
  image_quality: z.object({
    lighting: z.enum(['good', 'ok', 'bad']),
    blur: z.enum(['none', 'mild', 'high']),
    occlusion: z.enum(['none', 'some', 'heavy'])
  }),
  errors: z.array(
    z.object({
      code: z.string(),
      message: z.string()
    })
  )
});

const RankingSchema = z.object({
  request_id: z.string(),
  profile_used: z.object({
    arch_type: z.enum(['flat', 'normal', 'high', 'unknown']),
    usage: z.enum(['road', 'trail', 'treadmill', 'casual', 'racing']),
    weekly_mileage: z.number().int().min(0)
  }),
  ranked: z
    .array(
      z.object({
        model: z.string(),
        match_score: z.number().min(0).max(100),
        why: z.array(z.string()).min(1).max(6),
        specs: z.object({
          terrain: z.string().nullable(),
          stability: z.string().nullable(),
          drop_mm: z.number().nullable(),
          weight_g: z.number().nullable(),
          cushion: z.string().nullable()
        }),
        tradeoffs: z.array(z.string()).max(6),
        confidence: z.number().min(0).max(1)
      })
    )
    .max(5),
  avoid: z
    .array(
      z.object({
        model: z.string(),
        reason: z.string(),
        confidence: z.number().min(0).max(1)
      })
    )
    .max(5),
  fallback_needed: z.boolean(),
  errors: z.array(
    z.object({
      code: z.string(),
      message: z.string()
    })
  )
});

function safeParseJsonFromModel(text: string): any {
  // Best case: the model returns pure JSON.
  try {
    return JSON.parse(text);
  } catch {
    // Common failure case: extra text around JSON.
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(text.slice(first, last + 1));
    }
    throw new Error('Model output is not valid JSON');
  }
}

export async function runVision(args: { imageUrl: string; mimeType: string; buffer: Buffer }): Promise<VisionResult> {
  const request_id = randomUUID();

  const { imageUrl, mimeType, buffer } = args;

  if (MOCK_VISION || !openai) {
    return {
      request_id,
      candidates: [
        { raw_label: 'Nike Pegasus 40', brand: 'Nike', model: 'Pegasus 40', confidence: 0.78 },
        { raw_label: 'Brooks Ghost 15', brand: 'Brooks', model: 'Ghost 15', confidence: 0.74 },
        { raw_label: 'Hoka Clifton 9', brand: 'Hoka', model: 'Clifton 9', confidence: 0.69 }
      ],
      image_quality: { lighting: 'ok', blur: 'mild', occlusion: 'some' },
      errors: []
    };
  }

  const prompt = `
Analyze this image of a retail running shoe wall.

TASK:
- Identify up to 8 distinct running shoe models visible.
- Prefer popular running shoe lines.
- If unsure about exact version (e.g., Pegasus 40 vs 41), make best guess and lower confidence.

OUTPUT:
Return STRICT JSON ONLY in this format:

{
  "request_id": "${request_id}",
  "candidates": [
    {
      "raw_label": "Nike Pegasus 40",
      "brand": "Nike",
      "model": "Pegasus 40",
      "confidence": 0.0,
      "bbox": null,
      "notes": null
    }
  ],
  "image_quality": {
    "lighting": "good|ok|bad",
    "blur": "none|mild|high",
    "occlusion": "none|some|heavy"
  },
  "errors": []
}

RULES:
- confidence is between 0 and 1
- bbox should be null unless you can estimate normalized coords reliably
- No markdown, no commentary, JSON only
`;

  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

    try {
    const resp = await openai.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: dataUrl, detail: 'auto' }
          ]
        }
      ]
    });

    const rawText = resp.output_text;
    const json = safeParseJsonFromModel(rawText);

    const validated = VisionSchema.safeParse(json);
    if (!validated.success) {
      return {
        request_id,
        candidates: [],
        image_quality: { lighting: 'ok', blur: 'mild', occlusion: 'some' },
        errors: [
          {
            code: 'VISION_SCHEMA_INVALID',
            message: validated.error.message
          }
        ]
      };
    }

    return validated.data;

  } catch (e: any) {
    const status = e?.status ?? e?.response?.status ?? null;
    const message = String(e?.message || e);

    return {
      request_id,
      candidates: [],
      image_quality: { lighting: 'ok', blur: 'mild', occlusion: 'some' },
      errors: [
        {
          code: 'VISION_UPSTREAM_ERROR',
          message: `OpenAI failed (${status ?? 'unknown'}): ${message}`
        }
      ]
    };
  }

}


export async function runRanking(args: {
  requestId: string;
  profile: { arch_type: ArchType; usage: Usage; weekly_mileage: number };
  candidates: { brand: string | null; model: string | null; raw_label: string; confidence: number }[];
  specsByName: Record<string, any>;
  visionFailed: boolean;
}): Promise<RecommendationsResult> {

  const { requestId, profile, candidates, visionFailed } = args;

  if (visionFailed) {
    return {
      request_id: requestId,
      profile_used: profile,
      ranked: [],
      avoid: [],
      fallback_needed: true,
      errors: [
        {
          code: 'VISION_UNAVAILABLE',
          message: 'Automatic shoe detection unavailable. Use manual search.'
        }
      ]
    };
  }


  if (MOCK_RANKING || !openai) {
    const ranked = candidates
      .filter(c => c.brand && c.model)
      .slice(0, 3)
      .map((c, i) => ({
        model: `${c.brand} ${c.model}`,
        match_score: 90 - i * 8,
        why: [`Matches ${profile.usage} usage`, `Heuristic match for ${profile.arch_type} arch`],
        specs: {
          terrain: profile.usage,
          stability: profile.arch_type === 'flat' ? 'stable' : 'neutral',
          drop_mm: 8,
          weight_g: 290,
          cushion: 'medium'
        },
        tradeoffs: ['Mock tradeoff'],
        confidence: 0.65
      }));

    const mock: RecommendationsResult = {
      request_id: requestId,
      profile_used: profile,
      ranked,
      avoid: [],
      fallback_needed: ranked.length === 0,
      errors: []
    };

    // validate our own output too (optional but nice)
    const checked = RankingSchema.safeParse(mock);
    if (!checked.success) {
      return {
        request_id: requestId,
        profile_used: profile,
        ranked: [],
        avoid: [],
        fallback_needed: true,
        errors: [{ code: 'MOCK_RANK_SCHEMA_INVALID', message: checked.error.message }]
      };
    }

    return mock;
  }

  // We’ll implement real ranking after vision is stable.
  return {
    request_id: requestId,
    profile_used: profile,
    ranked: [],
    avoid: [],
    fallback_needed: true,
    errors: [{ code: 'RANKING_NOT_ENABLED', message: 'Real ranking not enabled yet.' }]
  };
}
