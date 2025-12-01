# Gemini Live Conversational API - Google Cloud Run Deployment Guide

## Overview

This document describes how to deploy the Gemini Live Conversational API to Google Cloud Run. The application is a real-time voice conversation system using Google's Gemini Live API with Vertex AI.

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Browser       │────▶│   Cloud Run          │────▶│  Vertex AI      │
│   (Frontend)    │◀────│   (Node.js Server)   │◀────│  Gemini Live    │
│   WebSocket     │     │   WebSocket Proxy    │     │  API            │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
```

## Configuration Summary

| Setting | Value |
|---------|-------|
| **Project ID** | `cosmic-surface-479409-r8` |
| **Cloud Run Region** | `australia-southeast1` (Sydney) |
| **Vertex AI Region** | `us-central1` |
| **Service Account** | `gemini-live-sa@cosmic-surface-479409-r8.iam.gserviceaccount.com` |
| **Min Instances** | 1 (always warm) |
| **Max Instances** | 100 |
| **CPU** | 2 vCPU |
| **Memory** | 1 GiB |
| **Timeout** | 3600 seconds (60 minutes for WebSocket) |
| **Concurrency** | 80 requests per instance |
| **Session Affinity** | Enabled |

## Service URL

**Production:** https://gemini-live-api-762261163336.australia-southeast1.run.app

---

## Prerequisites

1. **Google Cloud SDK (gcloud)** installed and configured
2. **Docker Desktop** installed and running (for local builds on ARM Macs)
3. **Node.js 20+** for local development
4. **Google Cloud Project** with billing enabled

---

## Deployment Steps

### Step 1: Enable Required Google Cloud APIs

```bash
gcloud services enable run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  --project cosmic-surface-479409-r8
```

### Step 2: Create Service Account with Vertex AI Permissions

```bash
# Create service account
gcloud iam service-accounts create gemini-live-sa \
  --display-name="Gemini Live API Service Account" \
  --project cosmic-surface-479409-r8

# Grant Vertex AI permissions
gcloud projects add-iam-policy-binding cosmic-surface-479409-r8 \
  --member="serviceAccount:gemini-live-sa@cosmic-surface-479409-r8.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

### Step 3: Configure Docker for Artifact Registry

```bash
gcloud auth configure-docker australia-southeast1-docker.pkg.dev --quiet
```

### Step 4: Build Docker Image for AMD64 (Required for ARM Macs)

**Important:** If you're on an Apple Silicon Mac (M1/M2/M3), you MUST build for `linux/amd64` platform, as Cloud Run runs on x86_64 architecture.

```bash
# Build for AMD64 platform
docker build --platform linux/amd64 -t gemini-live-api .
```

### Step 5: Tag and Push to Artifact Registry

```bash
# Tag the image
docker tag gemini-live-api \
  australia-southeast1-docker.pkg.dev/cosmic-surface-479409-r8/cloud-run-source-deploy/gemini-live-api:latest

# Push to Artifact Registry
docker push \
  australia-southeast1-docker.pkg.dev/cosmic-surface-479409-r8/cloud-run-source-deploy/gemini-live-api:latest
```

### Step 6: Deploy to Cloud Run

```bash
gcloud run deploy gemini-live-api \
  --project cosmic-surface-479409-r8 \
  --image australia-southeast1-docker.pkg.dev/cosmic-surface-479409-r8/cloud-run-source-deploy/gemini-live-api:latest \
  --region australia-southeast1 \
  --platform managed \
  --allow-unauthenticated \
  --service-account gemini-live-sa@cosmic-surface-479409-r8.iam.gserviceaccount.com \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=cosmic-surface-479409-r8,VERTEX_AI_LOCATION=us-central1" \
  --min-instances 1 \
  --max-instances 100 \
  --timeout 3600 \
  --cpu 2 \
  --memory 1Gi \
  --concurrency 80 \
  --session-affinity
```

### Step 7: Enable Public Access (Disable IAM Check)

If your organization has IAM policies that prevent `allUsers` access:

```bash
gcloud run services update gemini-live-api \
  --project cosmic-surface-479409-r8 \
  --region australia-southeast1 \
  --no-invoker-iam-check
```

---

## Files Modified/Created for Deployment

### 1. `server.js` - Modified for Production

Key changes:
- Environment detection (`isProduction`)
- Dynamic `PROJECT_ID` from environment variable
- `PORT` from environment (Cloud Run provides `PORT=8080`)
- Static file serving for built frontend in production
- WebSocket timeout configuration (60 minutes)
- Express 5 compatible catch-all route (`/{*path}`)

```javascript
// Environment detection
const isProduction = process.env.NODE_ENV === 'production' || process.env.K_SERVICE;

// Configuration based on environment
let PROJECT_ID;
const LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

if (isProduction) {
  PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
} else {
  // Local: use service account JSON file
  const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'sylvan-cocoa-467005-c4-c4c38ee3f6b9.json');
  // ...
}

// Use PORT from environment (Cloud Run provides this)
const PORT = process.env.PORT || 3001;
```

### 2. `index.tsx` - Dynamic WebSocket URL

```typescript
// Proxy server URL - dynamic based on environment
const PROXY_WS_URL = import.meta.env.PROD
  ? `wss://${window.location.host}/ws`
  : 'ws://localhost:3001/ws';
```

### 3. `package.json` - Added Start Script

```json
{
  "scripts": {
    "start": "NODE_ENV=production node server.js"
  }
}
```

### 4. `Dockerfile` - Created

```dockerfile
# Single stage build for Cloud Run
FROM node:20-slim

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy all source files
COPY . .

# Build frontend (Vite)
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production

# Cloud Run provides PORT env var (default 8080)
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

# Start the server
CMD ["node", "server.js"]
```

### 5. `.dockerignore` - Created

```
node_modules
dist
.git
.gitignore
.vscode
.idea
.env
.env.*
*.json
!package.json
!package-lock.json
!tsconfig.json
*.md
LICENSE
*.test.*
*.spec.*
__tests__
.DS_Store
*.log
```

### 6. `.gcloudignore` - Created

```
.git
.gitignore
node_modules
dist
.vscode
.idea
.env
.env.*
sylvan-cocoa-*.json
*-service-acct*.json
*.md
LICENSE
*.test.*
*.spec.*
__tests__
.claude
.DS_Store
*.log
```

---

## Verification Commands

### Test Health Endpoint

```bash
curl https://gemini-live-api-762261163336.australia-southeast1.run.app/health
```

Expected response:
```json
{"status":"ok","project":"cosmic-surface-479409-r8","mode":"production"}
```

### View Logs

```bash
gcloud run logs read gemini-live-api \
  --project cosmic-surface-479409-r8 \
  --region australia-southeast1 \
  --limit 50
```

### Check Service Status

```bash
gcloud run services describe gemini-live-api \
  --project cosmic-surface-479409-r8 \
  --region australia-southeast1
```

---

## Redeployment (After Code Changes)

When you make changes to the code, follow these steps to redeploy:

```bash
# 1. Build new Docker image (on ARM Mac, use --platform)
docker build --platform linux/amd64 -t gemini-live-api .

# 2. Tag with new version or latest
docker tag gemini-live-api \
  australia-southeast1-docker.pkg.dev/cosmic-surface-479409-r8/cloud-run-source-deploy/gemini-live-api:latest

# 3. Push to Artifact Registry
docker push \
  australia-southeast1-docker.pkg.dev/cosmic-surface-479409-r8/cloud-run-source-deploy/gemini-live-api:latest

# 4. Deploy new revision
gcloud run deploy gemini-live-api \
  --project cosmic-surface-479409-r8 \
  --image australia-southeast1-docker.pkg.dev/cosmic-surface-479409-r8/cloud-run-source-deploy/gemini-live-api:latest \
  --region australia-southeast1
```

---

## Rollback

If you need to rollback to a previous version:

```bash
# List all revisions
gcloud run revisions list \
  --project cosmic-surface-479409-r8 \
  --service gemini-live-api \
  --region australia-southeast1

# Rollback to specific revision
gcloud run services update-traffic gemini-live-api \
  --project cosmic-surface-479409-r8 \
  --region australia-southeast1 \
  --to-revisions REVISION_NAME=100
```

---

## Troubleshooting

### Issue: "exec format error" on startup

**Cause:** Docker image built on ARM Mac without `--platform linux/amd64`

**Solution:**
```bash
docker build --platform linux/amd64 -t gemini-live-api .
```

### Issue: Express 5 route error "Missing parameter name at index"

**Cause:** Express 5 changed wildcard route syntax from `*` to `{*param}`

**Solution:** Update catch-all route in `server.js`:
```javascript
// Before (Express 4)
app.get('*', handler);

// After (Express 5)
app.get('/{*path}', handler);
```

### Issue: 403 Forbidden - Organization Policy

**Cause:** Google Cloud organization policy blocks `allUsers`

**Solution:**
```bash
gcloud run services update gemini-live-api \
  --project cosmic-surface-479409-r8 \
  --region australia-southeast1 \
  --no-invoker-iam-check
```

### Issue: WebSocket connection timeout

**Cause:** Default Cloud Run timeout is 5 minutes

**Solution:** Set `--timeout 3600` in deploy command (max 60 minutes)

---

## Cost Considerations

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| Cloud Run (1 min instance, 2 vCPU, 1GB, always on) | ~$50-70 |
| Vertex AI Gemini Live API | Based on audio minutes |
| Egress (data transfer) | ~$0.12/GB after free tier |

To reduce costs for development:
- Set `--min-instances 0` to scale to zero when idle
- Reduce `--cpu` and `--memory` if not needed

---

## Local Development

For local development, the application uses a different service account file:

```bash
# Start backend server (uses sylvan-cocoa-467005-c4 project)
npm run server

# Start frontend dev server (in another terminal)
npm run dev

# Or run both together
npm run dev:all
```

Local URLs:
- Frontend: http://localhost:5174
- Backend: http://localhost:3001
- WebSocket: ws://localhost:3001/ws
- Health: http://localhost:3001/health
