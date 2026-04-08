import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { generateBatchImages } from "./app/api/generate/route.js"; // Note: using .js for ESM compatibility if needed, or just import directly if tsx handles it

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.post("/api/generate", async (req, res) => {
    const { topic, promptList, apiKey } = req.body;

    if (!topic || !promptList || !apiKey) {
      return res.status(400).json({ error: "Missing required fields: topic, promptList, or apiKey" });
    }

    try {
      // This might take a while, so we increase the timeout for this request
      req.setTimeout(600000); // 10 minutes
      
      const result = await generateBatchImages(topic, promptList, apiKey);
      res.json(result);
    } catch (error: any) {
      console.error("Generation failed:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
