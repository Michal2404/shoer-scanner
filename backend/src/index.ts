import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { analyzeRouter } from './routes/analyze.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 30
  })
);

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/analyze', analyzeRouter);

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
