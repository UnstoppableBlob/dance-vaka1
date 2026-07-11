import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-8 inline-block font-semibold text-slate-900 hover:text-indigo-700"
        >
          MotionMatch
        </Link>
        {children}
      </div>
    </main>
  );
}
