export function VideoCaptionNotice({
  className = "mt-2",
}: {
  className?: string;
}) {
  return (
    <p className={`${className} text-xs text-slate-600`}>
      Captions are not generated automatically. Put any spoken directions needed
      to complete the dance in the written instructions.
    </p>
  );
}
