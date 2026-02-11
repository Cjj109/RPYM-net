/**
 * RPYM - WhatsApp Gemini AI integration
 */

import type { ChatMessage } from './chat-handlers';
import { formatHistoryForGemini } from './chat-handlers';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Llama a Gemini 2.0 Flash-Lite para generar respuesta
 * Con soporte para historial de conversación (memoria)
 * Incluye retry automático para errores temporales
 */
export async function callGemini(
  userMessage: string,
  systemPrompt: string,
  apiKey: string,
  chatHistory: ChatMessage[] = []
): Promise<string> {
  const contents = [
    ...formatHistoryForGemini(chatHistory),
    {
      role: 'user',
      parts: [{ text: userMessage }]
    }
  ];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            generationConfig: {
              temperature: 0.8,
              maxOutputTokens: 1000,
              topP: 0.9,
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        const isRetryable = response.status === 503 || response.status === 429 ||
                           errorText.includes('high demand') || errorText.includes('overloaded');

        if (isRetryable && attempt < MAX_RETRIES) {
          console.log(`[WhatsApp Gemini] Retry ${attempt + 1}/${MAX_RETRIES}...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }

        console.error('Gemini API error:', errorText);
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        throw new Error('No response from Gemini');
      }

      return text.trim();
    } catch (error) {
      if (attempt < MAX_RETRIES && !(error instanceof Error && error.message.includes('Gemini API error'))) {
        console.log(`[WhatsApp Gemini] Retry ${attempt + 1}/${MAX_RETRIES} after error...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}
