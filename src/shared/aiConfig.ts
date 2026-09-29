// Shared by the server (server.ts) and the task pane, so the UI can show exactly what the AI received
export const AI_MODEL = "gemini-2.5-flash";

// The server truncates anything longer than these before sending it to the model
export const MAX_SELECTION_CHARS = 10000;
export const MAX_CONTEXT_CHARS = 40000;
