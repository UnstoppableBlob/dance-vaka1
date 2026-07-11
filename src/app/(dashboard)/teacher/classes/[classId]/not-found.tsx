import Link from "next/link";

export default function ClassNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold text-slate-950">Class not found</h1>
      <p className="mt-3 text-slate-600">
        This class does not exist or is not part of your teacher account.
      </p>
      <Link href="/teacher" className="primary-button mx-auto mt-6">
        Return to classes
      </Link>
    </main>
  );
}
