# SynoraCare AI (Standalone)

This project is completely separate from RoleRocket AI.

## What is included

- Standalone backend API (Node.js + Express + MongoDB)
- Standalone frontend console (static HTML/CSS/JS)
- ISP/MAR document upload and text indexing
- Grounded question answering with citations
- Client assignment RBAC controls
- Audit logging for login, uploads, questions, and escalations
- DSP tracker photo capture (camera/file upload) stored with tracker entries

## Folder structure

- `backend/` API and models
- `frontend/` browser console

## Prerequisites

- Node.js 20+
- MongoDB running locally or remotely
- Optional: OpenAI API key for higher quality embeddings/answers

## 1) Configure backend

```bash
cd backend
cp .env.example .env
```

Set values in `.env`:

- `MONGODB_URI`
- `JWT_SECRET`
- `OPENAI_API_KEY` (optional, can be blank)
- `CORS_ORIGIN` (comma-separated; default `http://localhost:8080`)

Example production value:

- `CORS_ORIGIN=http://localhost:8080,https://synoracare.com,https://www.synoracare.com`

For production, point the frontend at `https://api.<your-domain>` or set `window.SYNORACARE_CONFIG.API_BASE` before `app.js` loads.

## 2) Start backend

```bash
cd backend
npm install
npm start
```

Backend runs on `http://localhost:8081`.

## 3) Start frontend

```bash
cd frontend
npm install
npm start
```

Frontend runs on `http://localhost:8080`.

## Deploy on Render

- This repo includes `render.yaml` for a backend web service + frontend static site.
- In Render, use **New +** -> **Blueprint** and select this repository.
- Set required secrets when prompted: `MONGODB_URI`, `JWT_SECRET`, and optionally `OPENAI_API_KEY`.
- After deploy, attach custom domains:
	- Frontend: `synoracare.com`, `www.synoracare.com`
	- Backend: `api.synoracare.com`

Tracker photo notes:

- Photo upload is optional on tracker entries.
- Photo files are limited to 5MB and image MIME types only.
- Photos are stored in MongoDB with the tracker record for accountability workflows.

## 4) First-time flow in UI

1. Bootstrap super admin + organization.
2. Login.
3. Create users (org_admin/supervisor/dsp).
4. Create clients.
5. Assign DSP to clients.
6. Upload ISP/MAR/care docs.
7. Ask grounded questions.
8. Review audit events.

## Safety behavior

- If sources are missing, assistant returns a no-answer escalation message.
- DSP users can ask only for assigned clients.
- Admin/supervisor can view org-wide data.

## API quick reference

- `POST /api/auth/bootstrap`
- `POST /api/auth/login`
- `GET,POST /api/clients`
- `GET /api/assignments/users`
- `POST /api/assignments/users`
- `GET,POST /api/assignments`
- `POST /api/documents/upload` (multipart)
- `POST /api/ask`
- `POST /api/ask/escalate`
- `GET /api/audit`
