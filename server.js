/**
 * Proxy server for Vertex AI authentication
 * Uses @google/genai SDK with service account for Live API
 *
 * Environment Support:
 * - Local: Uses service account JSON file (sylvan-cocoa-467005-c4)
 * - Production (Cloud Run): Uses built-in service account identity (cosmic-surface-479409-r8)
 */

import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Modality, StartSensitivity, EndSensitivity } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Environment detection
const isProduction = process.env.NODE_ENV === 'production' || process.env.K_SERVICE;

// Configuration based on environment
let PROJECT_ID;
const LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

if (isProduction) {
  // Production: Use environment variable (set by Cloud Run)
  PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
  console.log('Running in production mode');
} else {
  // Local development: Use service account JSON file
  const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'sylvan-cocoa-467005-c4-c4c38ee3f6b9.json');
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    const credentials = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    PROJECT_ID = credentials.project_id;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = SERVICE_ACCOUNT_PATH;
  } else {
    console.error('Service account file not found for local development');
    process.exit(1);
  }
  console.log('Running in local development mode');
}

console.log('Using project:', PROJECT_ID);
console.log('Using location:', LOCATION);

// System prompt for the medical assistant
const getAssistantInstructions = (patientInfo) => `
Patient Information (Already Collected)
• Name: ${patientInfo.name}
• Age: ${patientInfo.age}
• Gender: ${patientInfo.gender}

# Personality and Tone

## Identity
You are a compassionate, seasoned caregiver who has seen it all. You offer warmth and guidance, drawing from a wealth of experience to reassure the patient throughout the interaction.

## Task
You focus on collecting medical data while offering minimal patient education if needed. Your primary goal is to gather the information required by the physician for an effective assessment, but you provide brief clarifications or context when it's helpful for the patient's understanding.

## Demeanor
You are gentle yet persistent, ensuring thoroughness and completeness while still maintaining a caring and empathetic approach.

## Tone
Your voice is warm and conversational, like a trusted family doctor talking one-on-one with the patient.

## Level of Enthusiasm
You remain calm and measured, offering reassurance without appearing overly energetic or enthusiastic.

## Level of Formality
You speak casually, using everyday language and less formal greetings. You avoid overly clinical or bureaucratic terms whenever possible, though you stay medically accurate.

## Level of Emotion
You are openly compassionate, expressing empathy and concern when the patient describes their situation or discomfort.

## Filler Words
You occasionally use mild filler words such as "um" or "well" to create a natural, friendly flow without overdoing it.

## Pacing
You speak at an evenly-paced rhythm, giving the patient time to process each question and respond comfortably.

## Other details
You occasionally offer a brief encouraging phrase to help the patient feel more at ease. You also confirm and restate crucial details—like names or medications—to ensure accuracy.

# Instructions

1. Always introduce yourself as "Anzu" and greet the patient in English, using their provided name (e.g., "Hello ${patientInfo.name}, I'm doctor assist...").
2. Explain your purpose clearly: that you're here to help gather their medical history before they see the doctor.
3. Collect all relevant details:
   - Chief complaint (why they're visiting today).
   - History of Present Illness (onset, duration, severity, associated symptoms, aggravating/relieving factors).
   - Past Medical History (any chronic illnesses, previous diagnoses, hospitalizations).
   - Past Surgical History (any surgeries or procedures, with approximate dates).
   - Current Medications (names, dosages, frequency, reasons, plus any known allergies or reactions).
   - Family History (relevant illnesses in parents, siblings, or close relatives).
   - Social History (lifestyle, smoking, alcohol, occupation, diet, exercise, sexual history if relevant).
   - Review of Systems (a quick check of other body systems to spot additional issues or complaints).
4. Maintain a compassionate, patient-centered tone: never rush the patient, and respond with empathy.
5. Do not provide diagnoses or definitive medical advice—focus on collecting information and clarifying details.
6. Summarize all gathered information in a concise medical format, then confirm with the patient that you have the details correct.
7. Reassure the patient that you will forward this information to the doctor, and thank them for their cooperation.
8. If the patient spells out information or corrects a detail (like their name, phone number, or medication), repeat it back to confirm you have the correct spelling or value.

# Conversation States

[
  {
    "id": "1_greeting",
    "description": "Greet the patient in English, verify their name, and introduce yourself as 'doctor assist'. Explain your purpose.",
    "instructions": [
      "Greet the patient using their name (e.g., 'Hello ${patientInfo.name}, I'm doctor assist.').",
      "State that you will help gather their medical history before they see the doctor.",
      "If the patient spells their name or corrects the spelling, repeat it back to confirm."
    ],
    "examples": [
      "Hello ${patientInfo.name}, I'm doctor assist. I'm here to gather your medical history before you see the doctor. Is your name spelled ...?"
    ],
    "transitions": [
      {
        "next_step": "2_chief_complaint",
        "condition": "Once the greeting and name verification are complete."
      }
    ]
  },
  {
    "id": "2_chief_complaint",
    "description": "Ask about the patient's primary reason for visiting the doctor today.",
    "instructions": [
      "Politely ask the patient to describe their main concern or reason for the visit."
    ],
    "examples": [
      "What brings you in today?",
      "Could you tell me more about the main issue that led you to schedule this appointment?"
    ],
    "transitions": [
      {
        "next_step": "3_hpi",
        "condition": "After the chief complaint is captured."
      }
    ]
  },
  {
    "id": "3_hpi",
    "description": "Collect the History of Present Illness (HPI), including onset, duration, severity, associated symptoms, and aggravating/relieving factors.",
    "instructions": [
      "Ask questions about when the issue started, how long it has been going on, and any changes over time.",
      "Inquire about factors that make symptoms better or worse, and any related symptoms.",
      "Maintain a gentle, empathetic tone, and allow the patient time to respond fully."
    ],
    "examples": [
      "When did you first notice these symptoms?",
      "Have you observed anything that eases or worsens the discomfort?"
    ],
    "transitions": [
      {
        "next_step": "4_past_medical_history",
        "condition": "Once HPI details are gathered."
      }
    ]
  },
  {
    "id": "4_past_medical_history",
    "description": "Review the patient's past medical history for chronic illnesses, previous diagnoses, and hospitalizations.",
    "instructions": [
      "Ask about any chronic conditions (e.g., diabetes, hypertension).",
      "Inquire about past major diagnoses or hospital stays, noting approximate dates if known.",
      "Confirm spelling of any condition or medication the patient provides."
    ],
    "examples": [
      "Have you been diagnosed with any long-term conditions?",
      "Have you ever been hospitalized? If so, when and for what?"
    ],
    "transitions": [
      {
        "next_step": "5_past_surgical_history",
        "condition": "After the past medical history is collected."
      }
    ]
  },
  {
    "id": "5_past_surgical_history",
    "description": "Gather information about previous surgeries or procedures and their dates.",
    "instructions": [
      "Ask if the patient has undergone any operations or invasive procedures in the past.",
      "Note the approximate dates and reasons for each procedure."
    ],
    "examples": [
      "Have you had any surgeries? When did you have them?"
    ],
    "transitions": [
      {
        "next_step": "6_medications_allergies",
        "condition": "After capturing relevant surgical history."
      }
    ]
  },
  {
    "id": "6_medications_allergies",
    "description": "Ask about current medications, dosages, frequencies, and any known allergies or reactions.",
    "instructions": [
      "Request a full list of medications, including over-the-counter drugs, supplements, or vitamins.",
      "For each medication, clarify dosage, frequency, and the reason for use.",
      "Confirm spelling of each medication.",
      "Ask about any known drug or food allergies, including type of reaction if relevant."
    ],
    "examples": [
      "Could you tell me about any medications you're currently taking, including supplements?",
      "Are you aware of any medication or food allergies?"
    ],
    "transitions": [
      {
        "next_step": "7_family_history",
        "condition": "Once medications and allergies have been clarified."
      }
    ]
  },
  {
    "id": "7_family_history",
    "description": "Gather relevant family medical history involving parents, siblings, and close relatives.",
    "instructions": [
      "Ask if there are any significant family illnesses such as diabetes, heart disease, cancer, or genetic conditions.",
      "Clarify which family member(s) are affected."
    ],
    "examples": [
      "Does anyone in your immediate family have a history of serious illnesses or chronic conditions?"
    ],
    "transitions": [
      {
        "next_step": "8_social_history",
        "condition": "After capturing relevant family history."
      }
    ]
  },
  {
    "id": "8_social_history",
    "description": "Inquire about lifestyle factors such as smoking, alcohol use, occupation, diet, exercise, and sexual history if relevant.",
    "instructions": [
      "Approach sensitive topics (e.g., sexual history) professionally and only if relevant.",
      "Ask about smoking, alcohol, or substance use habits.",
      "Inquire briefly about occupation, exercise routine, and dietary habits."
    ],
    "examples": [
      "Could you tell me about your work? Do you have any exposure to chemicals or stressors?",
      "Do you smoke or use any tobacco products, or drink alcohol?"
    ],
    "transitions": [
      {
        "next_step": "9_review_of_systems",
        "condition": "After social history has been explored."
      }
    ]
  },
  {
    "id": "9_review_of_systems",
    "description": "Conduct a quick review of additional body systems to identify any overlooked symptoms or issues.",
    "instructions": [
      "Systematically check for symptoms related to major body systems (e.g., respiratory, cardiovascular, gastrointestinal, neurological).",
      "Give the patient a chance to mention any other concerns not covered so far."
    ],
    "examples": [
      "Have you noticed any unusual cough, shortness of breath, or chest pain?",
      "Any changes in bowel habits or digestion issues?"
    ],
    "transitions": [
      {
        "next_step": "10_summary_confirmation",
        "condition": "Once the patient has shared any additional concerns."
      }
    ]
  },
  {
    "id": "10_summary_confirmation",
    "description": "Summarize all gathered information and confirm with the patient.",
    "instructions": [
      "Recap the key points: chief complaint, HPI, past medical/surgical history, medications, allergies, family and social history, plus any relevant ROS findings.",
      "Ask the patient to verify the accuracy of your summary, and correct any errors.",
      "Reassure the patient that this information will be provided to their doctor."
    ],
    "examples": [
      "Let me summarize what we've discussed so far...",
      "Have I captured all the details correctly? Is there anything else you'd like to add or correct?"
    ],
    "transitions": [
      {
        "next_step": "11_closure",
        "condition": "After the patient confirms or corrects the summary."
      }
    ]
  },
  {
    "id": "11_closure",
    "description": "Provide a closing statement, thank the patient, and conclude the session.",
    "instructions": [
      "Thank the patient for their time and cooperation.",
      "Reiterate that the doctor will review this information.",
      "Wish them well and end the conversation in a polite, compassionate manner."
    ],
    "examples": [
      "Thank you for providing all these details. I'll share this with the doctor now.",
      "Take care, and please let me know if you think of anything else before the doctor sees you."
    ],
    "transitions": []
  }
]`;

// Default patient info (can be passed from frontend later)
const defaultPatientInfo = {
  name: 'John Doe',
  age: '35',
  gender: 'Male'
};

const server = http.createServer(app);

// Configure WebSocket server timeout for long-running sessions (60 minutes)
server.timeout = 0; // Disable timeout (Cloud Run handles this via --timeout flag)
server.keepAliveTimeout = 3600000; // 60 minutes in ms

const wss = new WebSocketServer({ server, path: '/ws' });

// In production, serve the built frontend
if (isProduction) {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));

  // Serve index.html for all non-API routes (SPA support)
  // Express 5 requires named params, use regex-like pattern for catch-all
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/ws') || req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', project: PROJECT_ID, mode: isProduction ? 'production' : 'development' });
});

// Store active sessions
const sessions = new Map();

// WebSocket proxy for Live API (voice) and Standard Streaming API (text)
wss.on('connection', async (clientWs, req) => {
  // Parse mode from query string (default to 'voice' for backward compatibility)
  const url = new URL(req.url, `http://${req.headers.host}`);
  const mode = url.searchParams.get('mode') || 'voice';

  console.log(`Client connected to proxy (mode: ${mode})`);
  const sessionId = Date.now().toString();

  try {
    // Initialize GoogleGenAI with Vertex AI
    const client = new GoogleGenAI({
      vertexai: true,
      project: PROJECT_ID,
      location: LOCATION,
    });

    // ============================================
    // PLAYGROUND MODE: Test Gemini with custom config
    // ============================================
    if (mode === 'playground') {
      console.log('Setting up playground mode');

      // Store session info
      sessions.set(sessionId, { type: 'playground' });

      // Notify client that session is ready
      clientWs.send(JSON.stringify({ type: 'session_open', mode: 'playground' }));

      // Handle incoming playground requests
      clientWs.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'playground_request') {
            const {
              model,
              systemInstruction,
              userPrompt,
              responseJsonSchema,
              useStructuredOutput,
              temperature,
              topK,
              topP,
              maxOutputTokens
            } = message;

            console.log(`Playground request: model=${model}, structured=${useStructuredOutput}`);

            // Build generation config
            const config = {};
            if (temperature !== undefined) config.temperature = temperature;
            if (topK !== undefined) config.topK = topK;
            if (topP !== undefined) config.topP = topP;
            if (maxOutputTokens !== undefined) config.maxOutputTokens = maxOutputTokens;
            if (systemInstruction) config.systemInstruction = systemInstruction;

            // Configure structured output if enabled
            if (useStructuredOutput && responseJsonSchema) {
              config.responseMimeType = 'application/json';
              config.responseSchema = responseJsonSchema;
            }

            const startTime = Date.now();

            try {
              // Build contents array for generateContentStream
              // System instruction is already in config (line 408), so just pass user prompt
              const contents = [{
                role: 'user',
                parts: [{ text: userPrompt }]
              }];

              // Use generateContentStream for streaming responses
              const stream = await client.models.generateContentStream({
                model: model,
                contents: contents,
                config: config,
              });

              let fullText = '';
              let usageMetadata = null;

              for await (const chunk of stream) {
                if (chunk.text) {
                  fullText += chunk.text;
                  clientWs.send(JSON.stringify({
                    type: 'playground_chunk',
                    text: chunk.text
                  }));
                }
                if (chunk.usageMetadata) {
                  usageMetadata = chunk.usageMetadata;
                }
              }

              const latencyMs = Date.now() - startTime;

              // Parse final response for structured output
              let finalResponse = fullText;
              if (useStructuredOutput) {
                try {
                  finalResponse = JSON.parse(fullText);
                } catch {
                  // Keep as string if parsing fails
                }
              }

              // Signal completion with metadata
              clientWs.send(JSON.stringify({
                type: 'playground_complete',
                response: finalResponse,
                metadata: {
                  model,
                  totalTokens: usageMetadata?.totalTokenCount,
                  latencyMs,
                }
              }));
            } catch (streamError) {
              console.error('Playground streaming error:', streamError);
              clientWs.send(JSON.stringify({
                type: 'playground_error',
                error: streamError.message
              }));
            }
          }
        } catch (error) {
          console.error('Error processing playground message:', error);
        }
      });

      clientWs.on('close', () => {
        console.log('Playground client disconnected:', sessionId);
        sessions.delete(sessionId);
      });

      return; // Exit early for playground mode
    }

    // ============================================
    // TEXT MODE: Use Standard Streaming API
    // ============================================
    if (mode === 'text') {
      console.log('Setting up text mode with standard streaming API (gemini-2.5-flash)');

      // Create chat session with automatic history management
      const chatSession = client.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: getAssistantInstructions(defaultPatientInfo)
        }
      });

      // Store chat session for this connection
      sessions.set(sessionId, { type: 'text', chatSession });
      console.log('Text chat session created:', sessionId);

      // Notify client that session is ready
      clientWs.send(JSON.stringify({ type: 'session_open', mode: 'text' }));

      // Handle incoming text messages
      clientWs.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'text' && message.text) {
            console.log('Received text message:', message.text.substring(0, 50) + '...');

            // Stream response back to client
            try {
              const stream = await chatSession.sendMessageStream({
                message: message.text,
              });

              for await (const chunk of stream) {
                if (chunk.text) {
                  clientWs.send(JSON.stringify({
                    type: 'text_chunk',
                    text: chunk.text
                  }));
                }
              }

              // Signal completion
              clientWs.send(JSON.stringify({ type: 'text_complete' }));
            } catch (streamError) {
              console.error('Error streaming response:', streamError);
              clientWs.send(JSON.stringify({ type: 'error', message: streamError.message }));
            }
          }
        } catch (error) {
          console.error('Error processing text message:', error);
        }
      });

      clientWs.on('close', () => {
        console.log('Text client disconnected, cleaning up session:', sessionId);
        sessions.delete(sessionId);
      });

      return; // Exit early for text mode
    }

    // ============================================
    // STT MODE: Transcription-only using Gemini Live API
    // ============================================
    if (mode === 'stt') {
      // ========== GEMINI LIVE API STT ==========
      // Use non-native-audio model that supports TEXT responseModalities
      const sttModel = 'gemini-2.0-flash-live-preview-04-09';
      console.log(`Connecting to Gemini Live API for STT: ${sttModel}`);

      const sttSessionConfig = {
        systemInstruction: {
          parts: [{ text: 'You are a transcription service. Listen and transcribe only. Do not respond conversationally.' }]
        },
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: {},
      };

      const sttSession = await client.live.connect({
        model: sttModel,
        callbacks: {
          onopen: () => {
            console.log('Gemini STT session opened');
            clientWs.send(JSON.stringify({ type: 'session_open', mode: 'stt' }));
          },
          onmessage: (message) => {
            if (message.serverContent?.inputTranscription) {
              clientWs.send(JSON.stringify({
                type: 'transcription',
                text: message.serverContent.inputTranscription.text,
                finished: message.serverContent.inputTranscription.finished || false
              }));
            }
          },
          onerror: (error) => {
            console.error('Gemini STT error:', error);
            clientWs.send(JSON.stringify({ type: 'error', message: error.message }));
          },
          onclose: (event) => {
            console.log('Gemini STT session closed:', event);
            clientWs.send(JSON.stringify({ type: 'session_close' }));
          },
        },
        config: sttSessionConfig,
      });

      sessions.set(sessionId, { type: 'stt-gemini', session: sttSession });
      console.log('Gemini STT session created:', sessionId);

      clientWs.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'audio') {
            sttSession.sendRealtimeInput({
              media: { data: message.data, mimeType: 'audio/pcm;rate=16000' },
            });
          }
        } catch (error) {
          console.error('Error processing Gemini STT message:', error);
        }
      });

      clientWs.on('close', () => {
        console.log('Gemini STT client disconnected:', sessionId);
        const sessionData = sessions.get(sessionId);
        if (sessionData && sessionData.session) {
          sessionData.session.close();
        }
        sessions.delete(sessionId);
      });

      return; // Exit early for STT mode
    }

    // ============================================
    // VOICE MODE: Use Live API (existing code)
    // ============================================
    const model = 'gemini-live-2.5-flash-preview-native-audio-09-2025';
    console.log(`Connecting to Vertex AI Live API with model: ${model}`);

    const sessionConfig = {
      systemInstruction: {
        parts: [{ text: getAssistantInstructions(defaultPatientInfo) }]
      },
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
      },
      // VAD settings for better detection of short utterances like "yes", "no"
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
          endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
          prefixPaddingMs: 300,
          silenceDurationMs: 500,
        }
      },
    };

    const session = await client.live.connect({
      model: model,
      callbacks: {
        onopen: () => {
          console.log('Vertex AI Live session opened');
          clientWs.send(JSON.stringify({ type: 'session_open', mode: 'voice' }));
        },
        onmessage: (message) => {
          // Forward all messages to client
          clientWs.send(JSON.stringify({ type: 'message', data: message }));
        },
        onerror: (error) => {
          console.error('Vertex AI error:', error);
          clientWs.send(JSON.stringify({ type: 'error', message: error.message }));
        },
        onclose: (event) => {
          console.log('Vertex AI session closed:', event);
          clientWs.send(JSON.stringify({ type: 'session_close', reason: event?.reason || 'unknown' }));
        },
      },
      config: sessionConfig,
    });

    sessions.set(sessionId, { type: 'voice', session });
    console.log('Voice session created:', sessionId);

    // Handle messages from client (voice mode)
    clientWs.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'audio') {
          // Send audio to Gemini
          session.sendRealtimeInput({
            media: {
              data: message.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (message.type === 'text') {
          // Send text to Gemini (for voice mode text input)
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: message.text }] }],
          });
        }
      } catch (error) {
        console.error('Error processing client message:', error);
      }
    });

    clientWs.on('close', () => {
      console.log('Voice client disconnected, closing session:', sessionId);
      const sessionData = sessions.get(sessionId);
      if (sessionData && sessionData.session) {
        sessionData.session.close();
        sessions.delete(sessionId);
      }
    });

  } catch (error) {
    console.error('Error setting up session:', error);
    clientWs.send(JSON.stringify({ type: 'error', message: error.message }));
    clientWs.close();
  }
});

// Use PORT from environment (Cloud Run provides this) or default to 3001 for local dev
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket available at /ws`);
  console.log(`📋 Project: ${PROJECT_ID}`);
  console.log(`📍 Location: ${LOCATION}`);
  console.log(`🔧 Mode: ${isProduction ? 'production' : 'development'}\n`);
});
