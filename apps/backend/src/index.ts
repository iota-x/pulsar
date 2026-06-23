import express from 'express';
import cors from 'cors';
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
  getDashboard,
} from './controllers/workflowController';
import { getAllLogs, getLogsByWorkflowId } from './controllers/logController';
import { errorHandler } from './middlewares/errorHandler';
import { authMiddleware } from './middlewares/authMiddleware';

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// --- Auth (public) ---
app.post('/auth/register', registerUser);
app.post('/auth/login', loginUser);

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
app.delete('/workflows/:id', authMiddleware, deleteWorkflow);

// --- Execution logs ---
app.get('/logs', authMiddleware, getAllLogs);
app.get('/logs/:workflowId', authMiddleware, getLogsByWorkflowId);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 Backend API running on http://localhost:${config.port}`);
});
