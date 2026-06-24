import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the worker's prisma client and side-effecting modules before importing
// the executor (hoisted so the mocks exist when vi.mock factories run).
const { prismaMock, handlerMock } = vi.hoisted(() => ({
  prismaMock: {
    workflow: { findUnique: vi.fn() },
    log: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  },
  handlerMock: vi.fn(),
}));

vi.mock('../prisma', () => ({ default: prismaMock }));
vi.mock('../actions', () => ({ actionHandlers: { store_log: handlerMock } }));
vi.mock('../notify', () => ({ notifyFailure: vi.fn().mockResolvedValue(undefined) }));

import { executeWorkflow } from '../executor';

const baseWorkflow = {
  id: 'wf_1',
  name: 'Test',
  isActive: true,
  user: { walletAddress: null },
  actions: [{ id: 'a1', type: 'store_log', config: {}, order: 0 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.workflow.findUnique.mockResolvedValue(baseWorkflow);
});

describe('executeWorkflow — exactly-once', () => {
  it('runs the action and finalizes the log on a fresh event', async () => {
    prismaMock.log.create.mockResolvedValue({ id: 'log_1' });
    handlerMock.mockResolvedValue('stored');

    await executeWorkflow({
      workflowId: 'wf_1',
      triggerData: { triggerType: 'transaction_confirmed', signature: 'sig1' },
    });

    expect(handlerMock).toHaveBeenCalledOnce();
    expect(prismaMock.log.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'log_1' }, data: expect.objectContaining({ status: 'success' }) }),
    );
  });

  it('skips a duplicate event (unique violation) without running actions', async () => {
    prismaMock.log.create.mockRejectedValue({ code: 'P2002' }); // dedupeKey already claimed

    await executeWorkflow({
      workflowId: 'wf_1',
      triggerData: { triggerType: 'transaction_confirmed', signature: 'sig1' },
    });

    expect(handlerMock).not.toHaveBeenCalled();
    expect(prismaMock.log.update).not.toHaveBeenCalled();
  });

  it('dry-run never claims, runs, or persists anything', async () => {
    await executeWorkflow({
      workflowId: 'wf_1',
      triggerData: { triggerType: 'transaction_confirmed', signature: 'sig1' },
      dryRun: true,
    });

    expect(prismaMock.log.create).not.toHaveBeenCalled();
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it('records failed status when the action throws', async () => {
    prismaMock.log.create.mockResolvedValue({ id: 'log_2' });
    handlerMock.mockRejectedValue(new Error('boom'));

    await executeWorkflow({
      workflowId: 'wf_1',
      triggerData: { triggerType: 'transaction_confirmed', signature: 'sig2' },
    });

    expect(prismaMock.log.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });
});
