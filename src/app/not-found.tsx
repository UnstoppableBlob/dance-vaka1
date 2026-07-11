import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-700">
        404
      </p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-950">
        Page not found
      </h1>
      <p className="mt-3 text-slate-600">
        The page may have moved, or your account may not have access to it.
      </p>
      <Link href="/" className="primary-button mx-auto mt-6">
        Return home
      </Link>
    </main>
  );
}
