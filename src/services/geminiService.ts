import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function classifyClientResponse(response: string) {
  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Classify the following client response to a script approval request: "${response}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          classification: {
            type: Type.STRING,
            enum: ["Approved", "Revision Requested", "Rejected", "Call Requested", "Unknown"],
            description: "The classification of the response."
          },
          reason: {
            type: Type.STRING,
            description: "Brief explanation for the classification."
          },
          revisionNotes: {
            type: Type.STRING,
            description: "Extracted revision notes if classification is 'Revision Requested'."
          }
        },
        required: ["classification", "reason"]
      }
    }
  });

  return JSON.parse(result.text);
}

export async function formatApprovalMessage(script: { title: string, content: string, version: number }, clientName: string, channel: string, deadline: string) {
  const prompt = `Format a ${channel} message to client ${clientName} for script "${script.title}" (v${script.version}). 
  Deadline: ${deadline}. 
  Script content: ${script.content}. 
  Include clear CTAs: Approve, Request Revisions, or Reject.`;

  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "You are a professional account manager at Scrollhouse. Your tone is polite, clear, and action-oriented."
    }
  });

  return result.text;
}
