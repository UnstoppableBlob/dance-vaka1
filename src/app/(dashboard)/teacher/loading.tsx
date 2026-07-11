export default function TeacherLoading() {
  return (
    <main
      className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8 sm:px-10"
      aria-busy="true"
      aria-label="Loading teacher dashboard"
    >
      <p className="sr-only">Loading teacher dashboard…</p>
      <div className="animate-pulse" aria-hidden="true">
        <div className="h-16 border-b border-slate-200" />
        <div className="mt-10 h-9 w-56 rounded bg-slate-200" />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="h-24 rounded-lg bg-slate-200" />
          <div className="h-24 rounded-lg bg-slate-200" />
          <div className="h-24 rounded-lg bg-slate-200" />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="h-32 rounded-lg bg-slate-200" />
          <div className="h-32 rounded-lg bg-slate-200" />
        </div>
      </div>
    </main>
  );
}
