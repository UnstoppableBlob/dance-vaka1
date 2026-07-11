"use client";

import { useEffect, useRef } from "react";

export default function TeacherError({ reset }: { reset: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-center">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold text-slate-950"
      >
        We could not load your dashboard
      </h1>
      <p className="mt-3 text-slate-600">
        Please try again. Your data has not been changed.
      </p>
      <button
        type="button"
        onClick={reset}
        className="primary-button mx-auto mt-6"
      >
        Try again
      </button>
    </main>
  );
}
