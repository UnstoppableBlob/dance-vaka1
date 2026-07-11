"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export default function DashboardError({ reset }: { reset: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-center">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold text-slate-950"
      >
        We could not load this page
      </h1>
      <p className="mt-3 text-slate-600">
        Try again. Your saved data has not been changed.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="primary-button">
          Try again
        </button>
        <Link href="/" className="secondary-button">
          Return home
        </Link>
      </div>
    </main>
  );
}
