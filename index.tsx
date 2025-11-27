/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {decode, decodeAudioData, encode} from './utils';
import {PatientInfo} from './system_prompt';
import './visual-3d';

// Proxy server URL
const PROXY_WS_URL = 'ws://localhost:3001/ws';

// Type for conversation entries
interface ConversationEntry {
  role: 'user' | 'ai';
  text: string;
}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';

  // Conversation history - stores all completed transcriptions
  @state() conversationHistory: ConversationEntry[] = [];
  // Current in-progress transcriptions (while speaking)
  @state() currentUserInput = '';
  @state() currentAiOutput = '';

  // Add patient info state
  @state() patientInfo: PatientInfo = {
    name: 'John Doe',
    age: '35',
    gender: 'Male'
  };

  private ws: WebSocket | null = null;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  // Add audio isolation properties
  private microphoneStream: MediaStream | null = null;
  private isSessionConnected = false;

  // Reference to transcription container for auto-scroll
  private transcriptionContainer: HTMLElement | null = null;

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
    }

    #transcription {
      position: absolute;
      top: 5vh;
      left: 5vw;
      right: 5vw;
      z-index: 10;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px;
      border-radius: 10px;
      max-height: 40vh;
      overflow-y: auto;
      font-family: Arial, sans-serif;
      line-height: 1.5;
      scroll-behavior: smooth;
    }

    .user-transcription {
      color: #87CEEB;
      margin-bottom: 10px;
      border-left: 3px solid #87CEEB;
      padding-left: 10px;
    }

    .ai-transcription {
      color: #90EE90;
      margin-bottom: 10px;
      border-left: 3px solid #90EE90;
      padding-left: 10px;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        display: none;
      }
    }
  `;

  constructor() {
    super();
    this.initAudio();
    this.connectToProxy();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
    this.outputNode.connect(this.outputAudioContext.destination);
  }

  private connectToProxy() {
    this.updateStatus('Connecting to Vertex AI via proxy...');
    console.log('Connecting to proxy:', PROXY_WS_URL);

    this.ws = new WebSocket(PROXY_WS_URL);

    this.ws.onopen = () => {
      console.log('Connected to proxy server');
      this.updateStatus('Connected to proxy. Waiting for Vertex AI session...');
    };

    this.ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log(`[${new Date().toISOString()}] Received from proxy:`, message.type);

        // Log all transcription messages for debugging
        if (message.type === 'message' && message.data?.serverContent) {
          const sc = message.data.serverContent;
          if (sc.inputTranscription) {
            console.log(`[TRANSCRIPTION - USER INPUT] ${new Date().toISOString()}:`, sc.inputTranscription);
          }
          if (sc.outputTranscription) {
            console.log(`[TRANSCRIPTION - AI OUTPUT] ${new Date().toISOString()}:`, sc.outputTranscription);
          }
          if (sc.turnComplete) {
            console.log(`[TRANSCRIPTION - TURN COMPLETE] ${new Date().toISOString()}`);
          }
        }

        if (message.type === 'session_open') {
          this.isSessionConnected = true;
          this.updateStatus('Connected! Click Start to begin.');
        } else if (message.type === 'error') {
          this.updateError(message.message);
          this.isSessionConnected = false;
        } else if (message.type === 'session_close') {
          this.isSessionConnected = false;
          this.updateStatus('Session closed. Reconnecting...');
          setTimeout(() => this.connectToProxy(), 2000);
        } else if (message.type === 'message' && message.data) {
          await this.handleGeminiMessage(message.data);
        }
      } catch (e) {
        console.error('Error parsing message:', e);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.updateError('Connection error. Make sure proxy server is running.');
      this.isSessionConnected = false;
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed');
      this.isSessionConnected = false;
      this.updateStatus('Disconnected. Reconnecting in 3 seconds...');
      setTimeout(() => this.connectToProxy(), 3000);
    };
  }

  private async handleGeminiMessage(message: any) {
    // Handle audio data
    const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData;

    if (audio?.data) {
      console.log('Received audio data, playing...');

      // Ensure audio context is running
      if (this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }

      this.nextStartTime = Math.max(
        this.nextStartTime,
        this.outputAudioContext.currentTime,
      );

      const audioBuffer = await decodeAudioData(
        decode(audio.data),
        this.outputAudioContext,
        24000,
        1,
      );
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);

      source.addEventListener('ended', () => {
        this.sources.delete(source);
      });

      source.start(this.nextStartTime);
      this.nextStartTime = this.nextStartTime + audioBuffer.duration;
      this.sources.add(source);
    }

    // Handle input transcription (user's speech) - ACCUMULATE chunks
    if (message.serverContent?.inputTranscription?.text) {
      this.currentUserInput += message.serverContent.inputTranscription.text;
      this.requestUpdate();
      this.scrollToBottom();
    }

    // When user input is finished, add to conversation history
    if (message.serverContent?.inputTranscription?.finished) {
      if (this.currentUserInput.trim()) {
        this.conversationHistory = [...this.conversationHistory,
          { role: 'user', text: this.currentUserInput.trim() }
        ];
        this.currentUserInput = '';
      }
      this.requestUpdate();
      this.scrollToBottom();
    }

    // Handle output transcription (AI's speech) - ACCUMULATE chunks
    if (message.serverContent?.outputTranscription?.text) {
      this.currentAiOutput += message.serverContent.outputTranscription.text;
      this.requestUpdate();
      this.scrollToBottom();
    }

    // When turn is complete, add AI output to history (don't clear everything)
    if (message.serverContent?.turnComplete) {
      if (this.currentAiOutput.trim()) {
        this.conversationHistory = [...this.conversationHistory,
          { role: 'ai', text: this.currentAiOutput.trim() }
        ];
        this.currentAiOutput = '';
      }
      this.requestUpdate();
      this.scrollToBottom();
    }

    // Handle interruption
    if (message.serverContent?.interrupted) {
      for (const source of this.sources.values()) {
        source.stop();
        this.sources.delete(source);
      }
      this.nextStartTime = 0;
      this.currentAiOutput = '';
      this.requestUpdate();
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  // Scroll transcription container to bottom
  private scrollToBottom() {
    setTimeout(() => {
      const container = this.shadowRoot?.querySelector('#transcription');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 0);
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();
    this.outputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      // Get microphone access with enhanced noise cancellation
      this.microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1,
        },
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      // Set up audio processing
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.microphoneStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.isSessionConnected || !this.ws) {
          return;
        }

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        // Convert Float32Array to Int16 PCM and then base64
        const int16 = new Int16Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          int16[i] = pcmData[i] * 32768;
        }
        const base64Data = encode(new Uint8Array(int16.buffer));

        // Send audio to proxy server
        try {
          if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: 'audio',
              data: base64Data,
            }));
          }
        } catch (e) {
          console.error('Error sending audio data:', e);
        }
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Use headphones for best results.');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.microphoneStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    // Stop microphone stream
    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach((track) => track.stop());
      this.microphoneStream = null;
    }

    this.updateStatus('Recording stopped. Click Start to begin again.');
  }

  private reset() {
    this.ws?.close();
    this.conversationHistory = [];
    this.currentUserInput = '';
    this.currentAiOutput = '';
    this.connectToProxy();
    this.updateStatus('Session cleared.');
  }

  render() {
    const hasContent = this.conversationHistory.length > 0 || this.currentUserInput || this.currentAiOutput;

    return html`
      <div>
        ${hasContent ? html`
          <div id="transcription">
            ${this.conversationHistory.map(entry => html`
              <div class="${entry.role === 'user' ? 'user-transcription' : 'ai-transcription'}">
                <strong>${entry.role === 'user' ? 'You:' : 'AI Assistant:'}</strong><br>
                ${entry.text}
              </div>
            `)}
            ${this.currentUserInput ? html`
              <div class="user-transcription" style="opacity: 0.7">
                <strong>You (speaking):</strong><br>
                ${this.currentUserInput}
              </div>
            ` : ''}
            ${this.currentAiOutput ? html`
              <div class="ai-transcription" style="opacity: 0.7">
                <strong>AI Assistant (speaking):</strong><br>
                ${this.currentAiOutput}
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div class="controls">
          <button
            id="resetButton"
            @click=${this.reset}
            ?disabled=${this.isRecording}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 -960 960 960"
              width="40px"
              fill="#ffffff">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
          <button
            id="startButton"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}>
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#c80000"
              xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="50" />
            </svg>
          </button>
          <button
            id="stopButton"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}>
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#000000"
              xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="0" width="100" height="100" rx="15" />
            </svg>
          </button>
        </div>

        <div id="status"> ${this.status || this.error} </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
