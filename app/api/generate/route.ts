import { GoogleGenAI } from "@google/genai";
import JSZip from "jszip";
import { put } from "@vercel/blob";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateBatchImages(topic: string, promptList: string[], apiKey: string) {
  const ai = new GoogleGenAI({ apiKey });
  const zip = new JSZip();
  const folder = zip.folder(topic) || zip;

  console.log(`Starting generation for topic: ${topic} (${promptList.length} prompts)`);

  for (let i = 0; i < promptList.length; i++) {
    const prompt = promptList[i];
    
    // 4 second delay as requested
    if (i > 0) {
      await delay(4000);
    }

    try {
      console.log(`Generating image ${i + 1}/${promptList.length}...`);
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: prompt }],
        },
        config: {
          // @ts-ignore - imageConfig is specific to Imagen models
          imageConfig: { aspectRatio: "1:1" },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      
      let imageFound = false;
      for (const part of parts) {
        if (part.inlineData) {
          const base64Data = part.inlineData.data;
          const mimeType = part.inlineData.mimeType;
          const extension = mimeType.split("/")[1] || "png";
          
          folder.file(`${i + 1}.${extension}`, base64Data, { base64: true });
          imageFound = true;
          break;
        }
      }

      if (!imageFound) {
        console.warn(`No image data found for prompt ${i + 1}`);
      }

    } catch (error) {
      console.error(`Error generating image ${i + 1}:`, error);
      // Continue with next prompt even if one fails
    }
  }

  console.log("Generating ZIP file...");
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  
  const filename = `${topic.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.zip`;
  
  console.log(`Uploading to Vercel Blob: ${filename}`);
  const blob = await put(`bulk-images/${filename}`, zipBuffer, {
    access: "public",
    contentType: "application/zip",
  });

  return { url: blob.url };
}
