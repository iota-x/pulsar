'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { TEMPLATE_BY_ID, DEFAULT_NETWORK } from '@/lib/types';
import {
  WorkflowBuilder,
  EMPTY_WORKFLOW,
  type WorkflowInitial,
  type WorkflowDraft,
} from '@/components/WorkflowBuilder';

export default function NewWorkflowPage() {
  const router = useRouter();
  const [initial, setInitial] = useState<WorkflowInitial | null>(null);
  const [mainnetEnabled, setMainnetEnabled] = useState(false);

  // Prefill from a template (?template=<id>) — one-click recipe start. Resolve
  // before mounting the builder so its seeded state already reflects the recipe.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('template');
    const tpl = id ? TEMPLATE_BY_ID[id] : undefined;
    if (!tpl) return setInitial(EMPTY_WORKFLOW);
    setInitial({
      name: tpl.name,
      description: tpl.description,
      network: DEFAULT_NETWORK,
      triggerType: tpl.trigger.type,
      triggerConfig: { ...tpl.trigger.config },
      actions: tpl.actions.map((a) => ({ type: a.type, config: { ...a.config } })),
    });
  }, []);

  useEffect(() => {
    api<{ mainnetEnabled: boolean }>('/config')
      .then((c) => setMainnetEnabled(c.mainnetEnabled))
      .catch(() => setMainnetEnabled(false));
  }, []);

  const create = async (draft: WorkflowDraft) => {
    await api('/workflows', { method: 'POST', body: JSON.stringify(draft) });
    router.push('/workflows');
  };

  if (!initial) return <p className="text-slate-400">Loading…</p>;

  return (
    <WorkflowBuilder
      heading="New workflow"
      submitLabel="Save workflow"
      initial={initial}
      onSubmit={create}
      mainnetEnabled={mainnetEnabled}
    />
  );
}
