const styles: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-rose-500/15 text-rose-400',
  partial: 'bg-amber-500/15 text-amber-400',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-slate-700 text-slate-300'}`}
    >
      {status}
    </span>
  );
}
