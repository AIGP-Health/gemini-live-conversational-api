# Gemini Live Conversational API

Real-time voice conversation app using Google Gemini Live API with Vertex AI for native audio transcription.

## Architecture

```
┌─────────────────┐      WebSocket       ┌─────────────────┐      Service Account    ┌─────────────────┐
│     Browser     │ ←─────────────────→  │  Proxy Server   │ ←───────────────────→   │   Vertex AI     │
│   (Frontend)    │    localhost:3001    │   (server.js)   │     Authentication      │   Live API      │
│   Port: 5174    │                      │   Port: 3001    │                         │                 │
└─────────────────┘                      └─────────────────┘                         └─────────────────┘
```

## Features

- Real-time voice conversation with Gemini AI
- Native audio transcription (both user input and AI output) via Vertex AI
- Medical assistant system prompt for patient intake
- Voice Activity Detection (VAD) for natural conversation flow

## Prerequisites

- Node.js (v18+)
- Google Cloud Project with Vertex AI API enabled
- Service Account JSON key with Vertex AI permissions
- Billing enabled on Google Cloud Project

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Service Account

1. Create a service account in Google Cloud Console
2. Grant it "Vertex AI User" role
3. Download the JSON key file
4. Place the JSON file in the project root
5. Update `server.js` line 24 with your JSON filename:

```javascript
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'your-service-account.json');
```

### 3. Enable Vertex AI API

1. Go to Google Cloud Console
2. Navigate to "APIs & Services" > "Enable APIs"
3. Search for "Vertex AI API" and enable it
4. Ensure billing is enabled on your project

## Running the Application

### Step 1: Start the Proxy Server

```bash
node server.js
```

You should see:
```
Using project: your-project-id

🚀 Proxy server running on http://localhost:3001
📡 WebSocket proxy available at ws://localhost:3001/ws
📋 Project: your-project-id
📍 Location: us-central1
```

### Step 2: Start the Frontend (in a new terminal)

```bash
npm run dev
```

You should see:
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5174/
```

### Step 3: Use the Application

1. Open http://localhost:5174 in your browser
2. Click the red "Start" button to begin recording
3. Speak into your microphone
4. The AI will respond with voice, and you'll see transcriptions for both user (blue) and AI (green)

## Configuration

### System Prompt

Edit the `getAssistantInstructions` function in `server.js` to customize the AI's behavior.

### Patient Info

Modify `defaultPatientInfo` in `server.js`:

```javascript
const defaultPatientInfo = {
  name: 'John Doe',
  age: '35',
  gender: 'Male'
};
```

### Voice Settings

Change the AI voice in `server.js` config:

```javascript
speechConfig: {
  voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
}
```

Available voices: Puck, Charon, Kore, Fenrir, Aoede

### VAD Settings

Adjust Voice Activity Detection in `server.js`:

```javascript
realtimeInputConfig: {
  automaticActivityDetection: {
    startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
    prefixPaddingMs: 300,    // Audio captured before speech detection
    silenceDurationMs: 500,  // Silence before turn ends
  }
}
```

## Troubleshooting

### "Vertex AI API has not been used in project"
- Enable Vertex AI API in Google Cloud Console

### "This API method requires billing to be enabled"
- Enable billing on your Google Cloud project

### "Model not found"
- The app uses `gemini-live-2.5-flash-preview-native-audio-09-2025` model
- Ensure your project has access to this model

### WebSocket connection fails
- Make sure proxy server is running on port 3001
- Check if another process is using port 3001: `lsof -i:3001`

### Transcription missing first words
- Increase `prefixPaddingMs` value in VAD settings (try 400-500ms)

## Documentation

- [Vertex AI Live API](https://cloud.google.com/vertex-ai/generative-ai/docs/live-api)
- [Gemini Live API Guide](https://ai.google.dev/gemini-api/docs/live)
- [Native Audio Models](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api)
