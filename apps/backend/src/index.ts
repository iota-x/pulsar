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
import { authLimiter, apiLimiter } from './middlewares/rateLimit';

const app = express();
app.set('trust proxy', 1); // behind Caddy/Nginx — needed for correct client IPs
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use(apiLimiter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Prebuilt workflow recipes (public — no user data).
app.get('/templates', (_req, res) => res.json(WORKFLOW_TEMPLATES));

// --- Auth (public, rate-limited) ---
app.post('/auth/register', authLimiter, registerUser);
app.post('/auth/login', authLimiter, loginUser);

// --- Auth (protected) ---
app.get('/auth/me', authMiddleware, getMe);
app.post('/auth/wallet', authMiddleware, linkWallet);

// --- Dashboard ---
app.get('/dashboard', authMiddleware, getDashboard);

// --- Workflows (trigger + actions managed inline) ---
app.post('/workflows', authMiddleware, createWorkflow);
app.get('/workflows', authMiddleware, getAllWorkflows);
app.get('/workflows/:id', authMiddleware, getWorkflowById);
app.put('/workflows/:id', authMiddleware, updateWorkflow);
app.patch('/workflows/:id/active', authMiddleware, toggleWorkflow);
app.post('/workflows/:id/run', authMiddleware, runWorkflow);
app.post('/workflows/:id/simulate', authMiddleware, simulateWorkflow);
app.delete('/workflows/:id', authMiddleware, deleteWorkflow);

// --- Execution logs ---
app.get('/logs', authMiddleware, getAllLogs);
app.get('/logs/:workflowId', authMiddleware, getLogsByWorkflowId);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 Backend API running on http://localhost:${config.port}`);
});
