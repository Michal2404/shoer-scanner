# Shoe Scanner 👟

**Multimodal AI system that analyzes photos of retail shoe walls and generates personalized running-shoe recommendations based on user biomechanics and usage patterns.**

---

## Overview

Choosing the right running shoe from a store display can be overwhelming: dozens of visually similar models, subtle differences in stability and cushioning, and meaningful consequences for comfort and injury risk.

**Shoe Scanner** combines computer vision, structured product data, and user-specific constraints to recommend the most suitable shoes from a single photo of a shoe wall.

The project is designed as a production-style ML system rather than a demo:

- Clear separation between perception (vision) and decision-making (ranking)
- Strict schema validation of AI outputs
- Persistent storage of scans and recommendations
- Graceful degradation when AI services are unavailable

---

## Core Features

- 📸 Image-based input: upload a photo of a retail shoe wall  
- 👟 Multi-object detection: identify multiple shoe models in a single image  
- 🧠 Personalized recommendations: rank shoes based on user profile (arch type, terrain, weekly mileage)  
- 📊 Explainable output: confidence scores and reasoning for each recommendation  
- 💾 Persistent inference: store scans, images, and recommendations for reuse and evaluation  
- 🛡️ Robust fallbacks: system remains usable when AI services fail or are unavailable  

---

## Architecture

```
Image Upload
↓
Storage (Supabase)
↓
Vision Layer (Multimodal AI)
↓
Candidate Shoes
↓
Spec Enrichment (PostgreSQL)
↓
Ranking / Recommendation Engine
↓
Cached Results (PostgreSQL)
```

### Key Design Choice

The **vision layer** (what shoes are visible) is intentionally separated from the **ranking layer** (which shoes are best).  
This enables replacement of the vision model with a custom CV pipeline without changing downstream logic.

---

## Tech Stack

- Backend: Node.js, Express, TypeScript  
- Database: PostgreSQL (Supabase)  
- Storage: Supabase Object Storage  
- AI / ML: Multimodal LLM (vision + reasoning)  
- Validation: Zod (strict JSON schema enforcement)  
- Infrastructure: Dockerized local Supabase environment  
- API: REST, rate-limited  

---

## Data Model

### Users

Stores runner profile used for personalization.

- `arch_type`
- `usage` (road, trail, treadmill, etc.)
- `weekly_mileage`

### Scans

Each uploaded image corresponds to one scan event.

- image URL
- user reference
- timestamp

### Shoes

Structured knowledge base of shoe specifications.

- brand, model
- terrain, stability, cushioning
- drop, weight

### Recommendations

Cached AI outputs per scan.

- ranked shoes
- avoidance suggestions
- confidence and reasoning
- fallback indicators

---

## AI Pipeline

### 1. Vision Layer

- Detects up to N distinct shoe models from a single image  
- Returns normalized candidates with confidence scores  
- Handles ambiguity and low-quality images explicitly  

### 2. Ranking Layer

- Combines detected candidates with structured shoe specs  
- Applies user constraints (biomechanics + usage)  
- Produces ranked, explainable recommendations  

### Reliability Measures

- Strict schema validation of model output  
- No unhandled exceptions from AI services  
- Automatic fallback when vision is unavailable  

---

## Running Locally

### Prerequisites

- Node.js 20+  
- Docker  
- Supabase CLI (`npx supabase`)  

### Start Supabase

```bash
npx supabase start
```

### Start Backend

```bash
cd backend
npm install
npm run dev
```

### Test Endpoint

```bash
curl -X POST "http://localhost:3001/analyze?user_id=<UUID>" \
  -F "image=@./images/shoe_wall.jpg"
```

