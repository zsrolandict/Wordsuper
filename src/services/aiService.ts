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
      // The server (and the rate limiter) answer non-stream errors as JSON: { error: "..." }
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let receivedDone = false;
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
          if (!line.startsWith('data: ')) continue;

          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') {
            receivedDone = true;
            done = true;
            break;
          }

          let data: { text?: string; error?: string };
          try {
            data = JSON.parse(dataStr);
          } catch {
            // Ignore malformed lines
            continue;
          }

          if (data.error) {
            throw new Error(data.error);
          }
          if (data.text) {
            fullText += data.text;
            onChunk(data.text);
          }
        }
      }
    }

    // Without the [DONE] marker the connection dropped mid-answer, so the text is incomplete
    if (!receivedDone) {
      throw new Error('The AI response stream ended unexpectedly.');
    }

    return fullText;
  } catch (error) {
    console.error('Error calling AI streaming service:', error);
    throw error;
  }
}
