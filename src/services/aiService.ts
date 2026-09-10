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

/**
 * Service to call the AI backend and stream the response
 */
export async function editDocumentTextStream(
  originalText: string,
  instruction: string,
  documentContext: string = "",
  mode: 'edit' | 'comment' | 'generate' = 'edit',
  onChunk: (chunk: string) => void
): Promise<string> {
  try {
    const response = await fetch('/api/edit-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ originalText, instruction, documentContext, mode }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let fullText = '';
    let buffer = '';

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') {
              done = true;
              break;
            }
            try {
              const data = JSON.parse(dataStr);
              if (data.error) {
                throw new Error(data.error);
              }
              if (data.text) {
                fullText += data.text;
                onChunk(data.text);
              }
            } catch (e) {
              // Ignore incomplete JSON
            }
          }
        }
      }
    }
    
    return fullText;
  } catch (error) {
    console.error('Error calling AI streaming service:', error);
    throw error;
  }
}
