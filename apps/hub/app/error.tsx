"use client";

import { Button } from "@/components/ui/button";

// A full reload: the failure may be the server's first render, which a client retry can't redo.
const reload = () => window.location.reload();

// Without this, a throw anywhere in the page replaces Busy with the framework's blank error.
export default function PageError() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-medium">Something went wrong</h1>
      <p className="text-muted-foreground text-sm" role="alert">
        Busy couldn&apos;t show this page. Your bots and conversations are safe.
      </p>
      <Button onClick={reload} size="sm">
        Reload
      </Button>
    </main>
  );
}
