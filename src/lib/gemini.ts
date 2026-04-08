import { GoogleGenAI } from "@google/genai";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function generateImage(prompt: string, apiKey: string, retries = 3): Promise<{ dataUrl: string | null; error?: string; status?: number }> {
  const ai = new GoogleGenAI({ apiKey });

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) await delay(3000 * attempt);

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: prompt }],
        },
        config: {
          imageConfig: { aspectRatio: "1:1" },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData) {
          return { dataUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` };
        }
      }
      
      return { dataUrl: null, error: 'NO_IMAGE_DATA' };
      
    } catch (error: any) {
      const status = error?.status;
      const errorMessage = error?.message || String(error);
      
      console.error(`Attempt ${attempt + 1} failed:`, errorMessage);
      
      if (status === 429 || errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('limit')) {
        if (attempt === retries - 1) return { dataUrl: null, error: 'RATE_LIMIT_EXCEEDED', status: 429 };
        await delay(10000); // Wait 10s on rate limit
        continue;
      }
      
      if (attempt === retries - 1) return { dataUrl: null, error: errorMessage, status };
    }
  }
  return { dataUrl: null, error: 'MAX_RETRIES_REACHED' };
}
