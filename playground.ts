/**
 * Gemini Playground Component
 * A UI for testing Gemini models with structured output, system prompts, and parameters
 */

import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {
  PlaygroundConfig,
  PlaygroundResponse,
  AVAILABLE_MODELS,
  DEFAULT_CONFIG,
  EXAMPLE_JSON_SCHEMA,
} from './playground-types';

// WebSocket URL - dynamic based on environment
const WS_URL = import.meta.env.PROD
  ? `wss://${window.location.host}/ws?mode=playground`
  : 'ws://localhost:3001/ws?mode=playground';

@customElement('gemini-playground')
export class GeminiPlayground extends LitElement {
  @state() private config: PlaygroundConfig = {...DEFAULT_CONFIG};
  @state() private response: PlaygroundResponse | null = null;
  @state() private isLoading = false;
  @state() private streamingText = '';  // Text accumulating during stream
  @state() private jsonSchemaInput = '';
  @state() private jsonSchemaError: string | null = null;
  @state() private isConnected = false;
  @state() private connectionStatus = 'Connecting...';

  private ws: WebSocket | null = null;

  // Collapsible panel states
  @state() private expandedPanels = {
    system: false,
    schema: false,
    parameters: false,
  };

  connectedCallback() {
    super.connectedCallback();
    this.connectWebSocket();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.ws?.close();
  }

  private connectWebSocket() {
    this.connectionStatus = 'Connecting...';
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log('Playground WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'session_open') {
          this.isConnected = true;
          this.connectionStatus = 'Connected';
        } else if (message.type === 'playground_chunk') {
          this.streamingText += message.text;
        } else if (message.type === 'playground_complete') {
          this.response = {
            success: true,
            response: message.response,
            metadata: message.metadata,
          };
          this.isLoading = false;
        } else if (message.type === 'playground_error') {
          this.response = {
            success: false,
            error: message.error,
          };
          this.isLoading = false;
        }
      } catch (e) {
        console.error('Error parsing message:', e);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.connectionStatus = 'Connection error';
      this.isConnected = false;
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed, reconnecting...');
      this.isConnected = false;
      this.connectionStatus = 'Disconnected. Reconnecting...';
      setTimeout(() => this.connectWebSocket(), 2000);
    };
  }

  static styles = css`
    :host {
      display: block;
      position: absolute;
      top: 5vh;
      left: 5vw;
      right: 5vw;
      bottom: 15vh;
      z-index: 10;
    }

    .playground-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      height: 100%;
      max-height: 100%;
    }

    @media (max-width: 900px) {
      .playground-container {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr 1fr;
      }
    }

    .panel {
      background: rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      padding: 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    .panel-title {
      font-size: 18px;
      font-weight: 600;
      color: white;
      margin: 0 0 16px 0;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      color: rgba(255, 255, 255, 0.9);
      font-size: 14px;
      margin-bottom: 6px;
      font-weight: 500;
    }

    select, input[type="text"], textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      color: white;
      font-size: 14px;
      font-family: inherit;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.2s ease, background 0.2s ease;
    }

    select:focus, input[type="text"]:focus, textarea:focus {
      border-color: rgba(255, 255, 255, 0.4);
      background: rgba(255, 255, 255, 0.1);
    }

    select option {
      background: #1a1a1a;
      color: white;
    }

    textarea {
      resize: vertical;
      min-height: 80px;
      font-family: 'Monaco', 'Menlo', monospace;
    }

    textarea.code {
      font-size: 12px;
      line-height: 1.5;
    }

    .collapsible-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      color: rgba(255, 255, 255, 0.9);
      font-size: 14px;
      margin-bottom: 8px;
      transition: all 0.2s ease;
    }

    .collapsible-header:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .collapsible-header.expanded {
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      margin-bottom: 0;
      border-bottom: none;
    }

    .collapsible-content {
      padding: 12px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-top: none;
      border-radius: 0 0 8px 8px;
      margin-bottom: 8px;
    }

    .chevron {
      transition: transform 0.2s ease;
    }

    .chevron.expanded {
      transform: rotate(180deg);
    }

    .toggle-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }

    .toggle-switch {
      position: relative;
      width: 44px;
      height: 24px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      cursor: pointer;
      transition: background 0.2s ease;
    }

    .toggle-switch.active {
      background: rgba(76, 175, 80, 0.7);
    }

    .toggle-switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s ease;
    }

    .toggle-switch.active::after {
      transform: translateX(20px);
    }

    .parameter-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }

    .parameter-row label {
      flex: 0 0 120px;
      color: rgba(255, 255, 255, 0.8);
      font-size: 13px;
    }

    .parameter-row input[type="range"] {
      flex: 1;
      height: 6px;
      -webkit-appearance: none;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
      outline: none;
    }

    .parameter-row input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      background: white;
      border-radius: 50%;
      cursor: pointer;
    }

    .parameter-row .value {
      flex: 0 0 60px;
      text-align: right;
      color: rgba(255, 255, 255, 0.6);
      font-size: 13px;
      font-family: monospace;
    }

    .submit-btn {
      width: 100%;
      padding: 14px 24px;
      background: rgba(76, 175, 80, 0.7);
      border: none;
      border-radius: 8px;
      color: white;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: auto;
    }

    .submit-btn:hover:not(:disabled) {
      background: rgba(76, 175, 80, 0.9);
    }

    .submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error-text {
      color: #ff6b6b;
      font-size: 12px;
      margin-top: 4px;
    }

    .response-container {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .response-content {
      flex: 1;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 16px;
      overflow: auto;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: rgba(255, 255, 255, 0.9);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .response-content.error {
      color: #ff6b6b;
      border-color: rgba(255, 107, 107, 0.3);
    }

    .response-content.loading {
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.5);
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid rgba(255, 255, 255, 0.2);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 12px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .cursor {
      animation: blink 1s step-end infinite;
      color: rgba(255, 255, 255, 0.8);
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    .metadata {
      display: flex;
      gap: 20px;
      padding: 12px 0;
      margin-top: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.6);
      font-size: 13px;
    }

    .metadata span {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .placeholder-text {
      color: rgba(255, 255, 255, 0.4);
      font-style: italic;
    }

    .copy-btn {
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .copy-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .response-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
  `;

  private togglePanel(panel: keyof typeof this.expandedPanels) {
    this.expandedPanels = {
      ...this.expandedPanels,
      [panel]: !this.expandedPanels[panel],
    };
  }

  private updateConfig<K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) {
    this.config = {...this.config, [key]: value};
  }

  private handleJsonSchemaChange(e: Event) {
    const value = (e.target as HTMLTextAreaElement).value;
    this.jsonSchemaInput = value;

    if (!value.trim()) {
      this.jsonSchemaError = null;
      this.config = {...this.config, responseJsonSchema: undefined};
      return;
    }

    try {
      const parsed = JSON.parse(value);
      this.jsonSchemaError = null;
      this.config = {...this.config, responseJsonSchema: parsed};
    } catch (err) {
      this.jsonSchemaError = `Invalid JSON: ${(err as Error).message}`;
    }
  }

  private loadExampleSchema() {
    this.jsonSchemaInput = EXAMPLE_JSON_SCHEMA;
    this.handleJsonSchemaChange({target: {value: EXAMPLE_JSON_SCHEMA}} as any);
  }

  private sendRequest() {
    if (!this.config.userPrompt.trim() || !this.ws || !this.isConnected) return;

    this.isLoading = true;
    this.streamingText = '';
    this.response = null;

    // Send request via WebSocket
    this.ws.send(JSON.stringify({
      type: 'playground_request',
      ...this.config,
    }));
  }

  private async copyResponse() {
    if (!this.response?.response) return;

    const text = typeof this.response.response === 'object'
      ? JSON.stringify(this.response.response, null, 2)
      : this.response.response;

    await navigator.clipboard.writeText(text);
  }

  private renderChevron(expanded: boolean) {
    return html`
      <svg class="chevron ${expanded ? 'expanded' : ''}" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" fill="none"/>
      </svg>
    `;
  }

  private renderParameterSlider(
    label: string,
    key: 'temperature' | 'topK' | 'topP' | 'maxOutputTokens',
    min: number,
    max: number,
    step: number
  ) {
    return html`
      <div class="parameter-row">
        <label>${label}</label>
        <input
          type="range"
          min="${min}"
          max="${max}"
          step="${step}"
          .value="${String(this.config[key])}"
          @input="${(e: Event) => this.updateConfig(key, +(e.target as HTMLInputElement).value)}"
        />
        <span class="value">${this.config[key]}</span>
      </div>
    `;
  }

  render() {
    return html`
      <div class="playground-container">
        <!-- Configuration Panel -->
        <div class="panel">
          <h2 class="panel-title">Configuration</h2>

          <!-- Model Selection -->
          <div class="form-group">
            <label>Model</label>
            <select
              .value="${this.config.model}"
              @change="${(e: Event) => this.updateConfig('model', (e.target as HTMLSelectElement).value)}"
            >
              ${AVAILABLE_MODELS.map(model => html`
                <option value="${model.id}">${model.name}</option>
              `)}
            </select>
          </div>

          <!-- System Prompt (Collapsible) -->
          <div
            class="collapsible-header ${this.expandedPanels.system ? 'expanded' : ''}"
            @click="${() => this.togglePanel('system')}"
          >
            <span>System Prompt</span>
            ${this.renderChevron(this.expandedPanels.system)}
          </div>
          ${this.expandedPanels.system ? html`
            <div class="collapsible-content">
              <textarea
                rows="4"
                placeholder="Enter system instructions..."
                .value="${this.config.systemInstruction}"
                @input="${(e: Event) => this.updateConfig('systemInstruction', (e.target as HTMLTextAreaElement).value)}"
              ></textarea>
            </div>
          ` : ''}

          <!-- User Prompt -->
          <div class="form-group">
            <label>User Prompt</label>
            <textarea
              rows="4"
              placeholder="Enter your prompt..."
              .value="${this.config.userPrompt}"
              @input="${(e: Event) => this.updateConfig('userPrompt', (e.target as HTMLTextAreaElement).value)}"
            ></textarea>
          </div>

          <!-- JSON Schema (Collapsible) -->
          <div
            class="collapsible-header ${this.expandedPanels.schema ? 'expanded' : ''}"
            @click="${() => this.togglePanel('schema')}"
          >
            <span>Structured Output (JSON Schema)</span>
            ${this.renderChevron(this.expandedPanels.schema)}
          </div>
          ${this.expandedPanels.schema ? html`
            <div class="collapsible-content">
              <div class="toggle-row">
                <div
                  class="toggle-switch ${this.config.useStructuredOutput ? 'active' : ''}"
                  @click="${() => this.updateConfig('useStructuredOutput', !this.config.useStructuredOutput)}"
                ></div>
                <span style="color: rgba(255,255,255,0.8); font-size: 13px;">Enable Structured Output</span>
                <button class="copy-btn" @click="${this.loadExampleSchema}" style="margin-left: auto;">
                  Load Example
                </button>
              </div>
              <textarea
                class="code"
                rows="6"
                placeholder='{"type": "object", "properties": {...}}'
                .value="${this.jsonSchemaInput}"
                @input="${this.handleJsonSchemaChange}"
                ?disabled="${!this.config.useStructuredOutput}"
              ></textarea>
              ${this.jsonSchemaError ? html`
                <div class="error-text">${this.jsonSchemaError}</div>
              ` : ''}
            </div>
          ` : ''}

          <!-- Parameters (Collapsible) -->
          <div
            class="collapsible-header ${this.expandedPanels.parameters ? 'expanded' : ''}"
            @click="${() => this.togglePanel('parameters')}"
          >
            <span>Generation Parameters</span>
            ${this.renderChevron(this.expandedPanels.parameters)}
          </div>
          ${this.expandedPanels.parameters ? html`
            <div class="collapsible-content">
              ${this.renderParameterSlider('Temperature', 'temperature', 0, 2, 0.1)}
              ${this.renderParameterSlider('Top K', 'topK', 1, 100, 1)}
              ${this.renderParameterSlider('Top P', 'topP', 0, 1, 0.05)}
              ${this.renderParameterSlider('Max Tokens', 'maxOutputTokens', 256, 16384, 256)}
            </div>
          ` : ''}

          <!-- Connection Status -->
          <div style="text-align: center; margin-bottom: 8px; font-size: 12px; color: ${this.isConnected ? 'rgba(76, 175, 80, 0.9)' : 'rgba(255, 255, 255, 0.5)'};">
            ${this.connectionStatus}
          </div>

          <!-- Submit Button -->
          <button
            class="submit-btn"
            @click="${this.sendRequest}"
            ?disabled="${this.isLoading || !this.config.userPrompt.trim() || !this.isConnected}"
          >
            ${this.isLoading ? 'Generating...' : 'Send Request'}
          </button>
        </div>

        <!-- Response Panel -->
        <div class="panel">
          <div class="response-header">
            <h2 class="panel-title" style="margin: 0; padding: 0; border: none;">Response</h2>
            ${this.response?.success ? html`
              <button class="copy-btn" @click="${this.copyResponse}">Copy</button>
            ` : ''}
          </div>

          <div class="response-container">
            ${this.isLoading ? html`
              <div class="response-content" style="${this.streamingText ? '' : 'display: flex; align-items: center; justify-content: center;'}">
                ${this.streamingText ? html`
                  ${this.streamingText}<span class="cursor">|</span>
                ` : html`
                  <div class="spinner"></div>
                  <span style="color: rgba(255,255,255,0.5);">Thinking...</span>
                `}
              </div>
            ` : this.response ? html`
              <div class="response-content ${this.response.success ? '' : 'error'}">
                ${this.response.success
                  ? (typeof this.response.response === 'object'
                      ? JSON.stringify(this.response.response, null, 2)
                      : this.response.response)
                  : `Error: ${this.response.error}`}
              </div>
              ${this.response.success && this.response.metadata ? html`
                <div class="metadata">
                  <span>Model: ${this.response.metadata.model}</span>
                  <span>Tokens: ${this.response.metadata.totalTokens ?? 'N/A'}</span>
                  <span>Latency: ${this.response.metadata.latencyMs}ms</span>
                </div>
              ` : ''}
            ` : html`
              <div class="response-content">
                <span class="placeholder-text">Response will appear here...</span>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }
}
