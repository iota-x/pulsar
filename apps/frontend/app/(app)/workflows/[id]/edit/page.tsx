'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Workflow, TriggerType, ActionType } from '@/lib/types';
import {
  WorkflowBuilder,
  EMPTY_WORKFLOW,
  type WorkflowInitial,
  type WorkflowDraft,
  type Config,
} from '@/components/WorkflowBuilder';

/** Coerce stored config (values may be numbers/bools) into the string-keyed form the builder edits. */
const toConfig = (config: Record<string, unknown> | undefined): Config =>
  Object.fromEntries(Object.entries(config ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)]));

export default function EditWorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [initial, setInitial] = useState<WorkflowInitial | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Workflow>(`/workflows/${id}`)
      .then((wf) => {
        setInitial({
          name: wf.name,
          description: wf.description ?? '',
          triggerType: (wf.trigger?.type as TriggerType) ?? EMPTY_WORKFLOW.triggerType,
          triggerConfig: toConfig(wf.trigger?.config),
          actions:
            wf.actions && wf.actions.length > 0
              ? wf.actions.map((a) => ({ type: a.type as ActionType, config: toConfig(a.config) }))
              : EMPTY_WORKFLOW.actions,
        });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const save = async (draft: WorkflowDraft) => {
    await api(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(draft) });
    router.push(`/workflows/${id}`);
  };

  if (error) return <p className="text-rose-400">{error}</p>;
  if (!initial) return <p className="text-slate-400">Loading…</p>;

  return <WorkflowBuilder heading="Edit workflow" submitLabel="Save changes" initial={initial} onSubmit={save} />;
}
