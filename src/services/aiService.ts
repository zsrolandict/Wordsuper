export interface AIEditResponse {
  result: string;
  error?: string;
}

/**
 * Service to call the AI backend and process the selected text
 * based on user instructions.
 */
export async function editDocumentText(
  originalText: string,
  instruction: string,
  documentContext: string = "",
  mode: 'edit' | 'comment' | 'generate' = 'edit'
): Promise<string> {
  try {
    const response = await fetch('/api/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ originalText, instruction, documentContext, mode }),
    });

    const data: AIEditResponse = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to edit text with AI');
    }

    return data.result;
  } catch (error) {
    console.error('Error calling AI service:', error);
    throw error;
  }
}
