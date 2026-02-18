export type ArchType = 'flat' | 'normal' | 'high' | 'unknown';
export type Usage = 'road' | 'trail' | 'treadmill' | 'casual' | 'racing';

export type VisionCandidate = {
  raw_label: string;
  brand: string | null;
  model: string | null;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
  notes?: string | null;
};

export type VisionResult = {
  request_id: string;
  candidates: VisionCandidate[];
  image_quality: {
    lighting: 'good' | 'ok' | 'bad';
    blur: 'none' | 'mild' | 'high';
    occlusion: 'none' | 'some' | 'heavy';
  };
  errors: { code: string; message: string }[];
};

export type ShoeSpecs = {
  terrain: string | null;
  stability: string | null;
  drop_mm: number | null;
  weight_g: number | null;
  cushion: string | null;
};

export type RankedRecommendation = {
  model: string;
  match_score: number;
  why: string[];
  specs: ShoeSpecs;
  tradeoffs: string[];
  confidence: number;
};

export type RecommendationsResult = {
  request_id: string;
  profile_used: {
    arch_type: ArchType;
    usage: Usage;
    weekly_mileage: number;
  };
  ranked: RankedRecommendation[];
  avoid: { model: string; reason: string; confidence: number }[];
  fallback_needed: boolean;
  errors: { code: string; message: string }[];
};
