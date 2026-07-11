import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-16 sm:px-10">
      <div className="max-w-2xl">
        <p className="mb-3 text-sm font-semibold tracking-wide text-indigo-700 uppercase">
          Learn through movement
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          Dance Academy
        </h1>
        <p className="mt-5 text-lg leading-8 text-slate-600">
          A classroom workspace for dance assignments, video practice, and
          pose-assisted teacher feedback.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/register" className="primary-button">
          Create account
        </Link>
        <Link href="/login" className="secondary-button">
          Sign in
        </Link>
      </div>

      <section
        aria-labelledby="foundation-heading"
        className="mt-12 grid gap-4 sm:grid-cols-3"
      >
        <h2 id="foundation-heading" className="sr-only">
          Application foundation
        </h2>
        {[
          ["Application", "Next.js App Router and TypeScript"],
          ["Data", "PostgreSQL with Prisma"],
          ["Video", "Private S3-compatible storage"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-2 font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
