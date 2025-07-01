/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import {getAssistantInstructions, PatientInfo} from './system_prompt';
import './visual-3d';

// Add type declarations at the top
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
  interface MediaDevices {
    getDisplayMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
  }
}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() outputTranscription = '';
  @state() inputTranscription = '';

  // Add patient info state
  @state() patientInfo: PatientInfo = {
    name: 'John Doe',
    age: '35',
    gender: 'Male'
  };

  private client: GoogleGenAI;
  private session: Session;
  private speechRecognition: SpeechRecognition | null = null;
  private inputAudioContext = new (window.AudioContext ||
    window.webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    window.webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  
  // Add audio isolation properties
  private microphoneStream: MediaStream | null = null;
  private audioWorklet: AudioWorkletNode | null = null;
  private isAIResponding = false;
  private speechRecognitionTimeout: number | null = null;

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
    this.initClient();
    this.initSpeechRecognition();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  // Enhanced speech recognition with better isolation
  private initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.speechRecognition = new SpeechRecognition();
      
      this.speechRecognition.continuous = true;
      this.speechRecognition.interimResults = true;
      this.speechRecognition.lang = 'en-US';
      this.speechRecognition.maxAlternatives = 1;
      
      this.speechRecognition.onresult = (event) => {
        // Only process if AI is not currently responding
        if (this.isAIResponding) {
          console.log('Ignoring speech recognition during AI response');
          return;
        }

        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          const confidence = event.results[i][0].confidence;
          
          // Only use high-confidence results to avoid picking up AI audio
          if (confidence === undefined || confidence > 0.7) {
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            } else {
              interimTranscript += transcript;
            }
          }
        }
        
        // Show interim results (partial transcription)
        if (finalTranscript || interimTranscript) {
          this.inputTranscription = finalTranscript + interimTranscript;
          this.requestUpdate();
        }
        
        // Clear final transcript after a delay
        if (finalTranscript) {
          setTimeout(() => {
            this.inputTranscription = '';
            this.requestUpdate();
          }, 3000);
        }
      };
      
      this.speechRecognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        
        // Don't restart on certain errors
        if (['network', 'not-allowed', 'service-not-allowed'].includes(event.error)) {
          return;
        }
        
        // Restart recognition on other errors, but not during AI response
        if (event.error !== 'no-speech' && !this.isAIResponding) {
          this.restartSpeechRecognition();
        }
      };
      
      this.speechRecognition.onend = () => {
        // Only restart if still recording and AI is not responding
        if (this.isRecording && !this.isAIResponding) {
          this.restartSpeechRecognition();
        }
      };

      this.speechRecognition.onstart = () => {
        console.log('Speech recognition started');
      };

    } else {
      console.warn('Speech recognition not supported in this browser');
    }
  }

  private restartSpeechRecognition() {
    if (this.speechRecognitionTimeout) {
      clearTimeout(this.speechRecognitionTimeout);
    }
    
    this.speechRecognitionTimeout = setTimeout(() => {
      if (this.isRecording && !this.isAIResponding && this.speechRecognition) {
        try {
          this.speechRecognition.start();
        } catch (e) {
          console.log('Speech recognition restart error:', e);
        }
      }
    }, 500);
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              // Mark AI as responding and stop speech recognition
              this.isAIResponding = true;
              this.stopSpeechRecognitionTemporarily();

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
                // Resume speech recognition when all AI audio finishes
                if (this.sources.size === 0) {
                  setTimeout(() => {
                    this.isAIResponding = false;
                    this.startSpeechRecognitionSafely();
                  }, 1000); // Wait 1 second after AI finishes to avoid picking up echo
                }
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            // Handle output transcription
            if (message.serverContent?.outputTranscription?.text) {
              this.outputTranscription += message.serverContent.outputTranscription.text;
              this.requestUpdate();
            }

            // Clear transcription when turn is complete
            if (message.serverContent?.turnComplete) {
              setTimeout(() => {
                this.outputTranscription = '';
                this.requestUpdate();
              }, 2000);
            }

            const interrupted = message.serverContent?.interrupted;
            if(interrupted) {
              // Stop all AI audio sources
              for(const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
              this.outputTranscription = '';
              this.requestUpdate();
              
              // Immediately mark AI as not responding and restart speech recognition
              this.isAIResponding = false;
              this.startSpeechRecognitionSafely();
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Close:' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}},
          },
          systemInstruction: {
            parts: [
              {
                text: getAssistantInstructions(this.patientInfo)
              }
            ]
          },
        },
      });
    } catch (e) {
      console.error(e);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
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
          // Add more constraints to isolate microphone input
          suppressLocalAudioPlayback: true,
          googEchoCancellation: true,
          googAutoGainControl: true,
          googNoiseSuppression: true,
          googHighpassFilter: true,
          googNoiseSuppression2: true,
          googEchoCancellation2: true,
          googAutoGainControl2: true,
        },
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      // Set up audio processing for Gemini
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
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        // Only send to Gemini if AI is not currently responding
        if (!this.isAIResponding) {
          this.session.sendRealtimeInput({media: createBlob(pcmData)});
        }
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      // Start speech recognition after a brief delay
      setTimeout(() => {
        this.startSpeechRecognitionSafely();
      }, 1000);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Use headphones for best results.');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private startSpeechRecognitionSafely() {
    if (this.speechRecognition && this.isRecording && !this.isAIResponding) {
      try {
        this.speechRecognition.start();
      } catch (e) {
        console.log('Speech recognition already started or error:', e);
      }
    }
  }

  private stopSpeechRecognitionTemporarily() {
    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch (e) {
        console.log('Error stopping speech recognition:', e);
      }
    }
    
    if (this.speechRecognitionTimeout) {
      clearTimeout(this.speechRecognitionTimeout);
      this.speechRecognitionTimeout = null;
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.microphoneStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;
    this.isAIResponding = false;

    // Stop speech recognition
    this.stopSpeechRecognitionTemporarily();

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
    this.session?.close();
    this.outputTranscription = '';
    this.inputTranscription = '';
    this.isAIResponding = false;
    
    // Stop speech recognition
    this.stopSpeechRecognitionTemporarily();
    
    this.initSession();
    this.updateStatus('Session cleared.');
  }

  render() {
    return html`
      <div>
        ${this.inputTranscription || this.outputTranscription ? html`
          <div id="transcription">
            ${this.inputTranscription ? html`
              <div class="user-transcription">
                <strong>You:</strong><br>
                ${this.inputTranscription}
              </div>
            ` : ''}
            ${this.outputTranscription ? html`
              <div class="ai-transcription">
                <strong>AI Assistant:</strong><br>
                ${this.outputTranscription}
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

        <div id="status"> ${this.error} </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
