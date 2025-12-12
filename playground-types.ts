/**
 * Type definitions for the Gemini Playground
 */

export interface PlaygroundConfig {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  responseJsonSchema?: object;
  useStructuredOutput: boolean;
  temperature: number;
  topK: number;
  topP: number;
  maxOutputTokens: number;
}

export interface PlaygroundResponse {
  success: boolean;
  response?: string | object;
  error?: string;
  metadata?: {
    model: string;
    totalTokens?: number;
    latencyMs: number;
  };
}

export interface ModelOption {
  id: string;
  name: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
];

export const DEFAULT_CONFIG: PlaygroundConfig = {
  model: 'gemini-2.5-flash',
  systemInstruction: '',
  userPrompt: '',
  useStructuredOutput: false,
  temperature: 1.0,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 1024,
};

export const EXAMPLE_JSON_SCHEMA = `{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "age": { "type": "number" },
    "email": { "type": "string" }
  },
  "required": ["name", "age"]
}`;
