const styles: Record<string, string> = {
  success: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  failed: 'bg-rose-500/10 text-rose-300 ring-rose-500/30',
  partial: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  simulated: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        styles[status] ?? 'bg-slate-700/40 text-slate-300 ring-white/10'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
