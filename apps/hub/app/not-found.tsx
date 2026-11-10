import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-medium">This page doesn&apos;t exist</h1>
      <p className="text-muted-foreground text-sm">
        The bot may have been deleted, or the link is wrong.
      </p>
      <Link className="text-sm underline underline-offset-4" href="/">
        Back to Busy
      </Link>
    </main>
  );
}
