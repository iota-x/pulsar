import express from 'express';
import cors from 'cors';
import { WORKFLOW_TEMPLATES } from '@web3-zapier/shared';
import { config } from './config';
import { registerUser, loginUser, getMe, linkWallet } from './controllers/userController';
import {
  createWorkflow,
  getAllWorkflows,
  getWorkflowById,
  updateWorkflow,
  toggleWorkflow,
  deleteWorkflow,
  runWorkflow,
  simulateWorkflow,
  getDashboard,
} from './controllers/workflowController';
import { getAllLogs, getLogsByWorkflowId } from './controllers/logController';
import { errorHandler } from './middlewares/errorHandler';
import { authMiddleware } from './middlewares/authMiddleware';
import { apiLimiter, actionLimiter, loginLimiter, registerLimiter } from './middlewares/rateLimit';

const app = express();
// Trust proxy hops (Tailscale Funnel / Caddy / Nginx) so req.ip reflects the real
// client. Tune TRUST_PROXY to the actual hop count if IP-based limits look off.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
app.use(cors({ origin: config.corsOrigin.split(',').map((o) => o.trim()) }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Prebuilt workflow recipes (public — no user data).
app.get('/templates', (_req, res) => res.json(WORKFLOW_TEMPLATES));

// Authed routes: authenticate first, then rate-limit per user (robust behind a
// proxy that may collapse client IPs).
const authed = [authMiddleware, apiLimiter];
const authedAction = [authMiddleware, actionLimiter];

// --- Auth (public, rate-limited) ---
app.post('/auth/register', registerLimiter, registerUser);
app.post('/auth/login', loginLimiter, loginUser);

// --- Auth (protected) ---
app.get('/auth/me', ...authed, getMe);
app.post('/auth/wallet', ...authed, linkWallet);

// --- Dashboard ---
app.get('/dashboard', ...authed, getDashboard);

// --- Workflows (trigger + actions managed inline) ---
app.post('/workflows', ...authed, createWorkflow);
app.get('/workflows', ...authed, getAllWorkflows);
app.get('/workflows/:id', ...authed, getWorkflowById);
app.put('/workflows/:id', ...authed, updateWorkflow);
app.patch('/workflows/:id/active', ...authed, toggleWorkflow);
app.post('/workflows/:id/run', ...authedAction, runWorkflow);
app.post('/workflows/:id/simulate', ...authedAction, simulateWorkflow);
app.delete('/workflows/:id', ...authed, deleteWorkflow);

// --- Execution logs ---
app.get('/logs', ...authed, getAllLogs);
app.get('/logs/:workflowId', ...authed, getLogsByWorkflowId);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 Backend API running on http://localhost:${config.port}`);
});
