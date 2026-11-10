"use client";

import { Download, FileText, Loader2 } from "lucide-react";
import Image from "next/image";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PreviewFile {
  contentType: string;
  id: string;
  name: string;
  size: number;
}

type Kind = "image" | "pdf" | "video" | "audio" | "word" | "sheet" | "text";

const WORD = /wordprocessingml|\.docx$/u;
const SHEET = /spreadsheet|ms-excel|csv|\.(?:xlsx|xls|ods|csv)$/u;
const TEXT =
  /^text\/|[+/]json|[+/]xml|yaml|markdown|\.(?:txt|md|json|ya?ml|xml|log|ts|tsx|js|py|sh|html|css)$/u;
// ponytail: big files go to Download instead of freezing the tab; raise if people ask.
const MAX_BYTES = 20 * 1_048_576;
const MAX_ROWS = 1000;
const MAX_COLS = 100;
const MAX_PAGES = 50;

/** What the modal can draw for a file, or null when it can only be downloaded. */
export function previewKind({ name, contentType, size }: PreviewFile) {
  const key = `${contentType.toLowerCase()} ${name.toLowerCase()}`;
  let kind: Kind | null = null;
  if (contentType.startsWith("image/")) {
    kind = "image";
  } else if (contentType.startsWith("video/")) {
    kind = "video";
  } else if (contentType.startsWith("audio/")) {
    kind = "audio";
  } else if (contentType === "application/pdf" || key.endsWith(".pdf")) {
    kind = "pdf";
  } else if (WORD.test(key)) {
    kind = "word";
  } else if (SHEET.test(key)) {
    kind = "sheet";
  } else if (TEXT.test(key)) {
    kind = "text";
  }
  // Images, video and audio stream natively; the rest is parsed in the tab.
  if (kind && !["image", "video", "audio"].includes(kind) && size > MAX_BYTES) {
    return null;
  }
  return kind;
}

const formatSize = (bytes: number) =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function FilePreviewDialog({
  file,
  onOpenChange,
}: {
  file: PreviewFile | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={file !== null}>
      <DialogContent className="flex h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        {file ? <PreviewBody file={file} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ file }: { file: PreviewFile }) {
  const src = `/api/files/${file.id}`;
  const kind = previewKind(file);
  return (
    <>
      <header className="border-border flex items-center gap-3 border-b py-2.5 pr-12 pl-4">
        <FileText
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-sm font-medium">
            {file.name}
          </DialogTitle>
          <DialogDescription className="text-[13px] tabular-nums">
            {formatSize(file.size)}
          </DialogDescription>
        </div>
        <a
          className={buttonVariants({ size: "sm", variant: "outline" })}
          download={file.name}
          href={`${src}?download`}
        >
          <Download aria-hidden="true" />
          Download
        </a>
      </header>
      <div className="bg-muted/40 min-h-0 flex-1 overflow-auto">
        {kind ? (
          <Viewer file={file} key={file.id} kind={kind} src={src} />
        ) : (
          <Message>
            No preview for this file type. Download it to open it.
          </Message>
        )}
      </div>
    </>
  );
}

function Viewer({
  file,
  kind,
  src,
}: {
  file: PreviewFile;
  kind: Kind;
  src: string;
}) {
  switch (kind) {
    case "image":
      return <ZoomableImage name={file.name} src={src} />;
    case "video":
      return (
        // biome-ignore lint/a11y/useMediaCaption: the file API exposes no caption track to attach
        <video autoPlay className="h-full w-full bg-black" controls src={src} />
      );
    case "audio":
      return (
        <div className="grid h-full place-items-center p-4">
          {/* biome-ignore lint/a11y/useMediaCaption: the file API exposes no caption track to attach */}
          <audio controls src={src} />
        </div>
      );
    case "pdf":
      return <PdfPages src={src} />;
    case "word":
      return <WordDocument name={file.name} src={src} />;
    case "sheet":
      return <Spreadsheet src={src} />;
    default:
      return <PlainText src={src} />;
  }
}

/** Fits the modal; a click switches to full width so long screenshots can be read by scrolling. */
function ZoomableImage({ src, name }: { src: string; name: string }) {
  const [zoomed, setZoomed] = useState(false);
  const toggle = useCallback(() => setZoomed((z) => !z), []);
  return (
    <button
      aria-label={zoomed ? "Fit image" : "Zoom image"}
      aria-pressed={zoomed}
      className={
        zoomed
          ? "block w-full cursor-zoom-out p-4"
          : "block size-full cursor-zoom-in p-4"
      }
      onClick={toggle}
      type="button"
    >
      <Image
        alt={name}
        className={
          zoomed
            ? "mx-auto h-auto w-full max-w-[1200px]"
            : "size-full object-contain"
        }
        height={1200}
        src={src}
        unoptimized
        width={1600}
      />
    </button>
  );
}

/** Runs `load` once on mount and tracks its state; `live()` turns false once the modal closes. */
function useLoad<T>(load: (live: () => boolean) => Promise<T>): {
  state: "loading" | "ready" | "error";
  data?: T;
} {
  const [result, setResult] = useState<{
    state: "loading" | "ready" | "error";
    data?: T;
  }>({ state: "loading" });
  // Viewers are keyed by file, so a mounted one never loads a second file.
  const first = useRef(load);
  useEffect(() => {
    let live = true;
    first
      .current(() => live)
      .then(
        (data) => live && setResult({ data, state: "ready" }),
        () => live && setResult({ state: "error" })
      );
    return () => {
      live = false;
    };
  }, []);
  return result;
}

async function fetchBytes(src: string) {
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`file ${res.status}`);
  }
  return res.arrayBuffer();
}

function Status({ state }: { state: "loading" | "ready" | "error" }) {
  if (state === "loading") {
    return (
      <Message>
        <Loader2 aria-hidden="true" className="size-5 animate-spin" />
        <span className="sr-only">Loading preview</span>
      </Message>
    );
  }
  if (state === "error") {
    return (
      <Message>The preview could not load. Download the file instead.</Message>
    );
  }
  return null;
}

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full min-h-48 items-center justify-center p-6 text-center text-sm">
      {children}
    </div>
  );
}

/** Every page as a canvas. pdf.js and not an <iframe>: Blob serves files as attachments. */
function PdfPages({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
  const { state, data: pages } = useLoad(async (live) => {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    const task = pdfjs.getDocument({ url: src });
    try {
      const doc = await task.promise;
      const target = box.current;
      if (!target) {
        return 0;
      }
      const width = Math.min(target.clientWidth - 32, 900);
      for (
        let n = 1;
        n <= Math.min(doc.numPages, MAX_PAGES) && live();
        n += 1
      ) {
        // biome-ignore lint/performance/noAwaitInLoops: pages render one at a time so the first shows up first
        const page = await doc.getPage(n);
        const scale =
          (width * (window.devicePixelRatio || 1)) /
          page.getViewport({ scale: 1 }).width;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className =
          "mx-auto block h-auto w-full max-w-[900px] bg-white shadow-sm";
        canvas.setAttribute("aria-label", `Page ${n}`);
        target.append(canvas);
        await page.render({ canvas, viewport }).promise;
      }
      return doc.numPages;
    } finally {
      task.destroy();
    }
  });
  return (
    <>
      <Status state={state} />
      <div className="flex flex-col gap-4 p-4" ref={box} />
      {pages && pages > MAX_PAGES ? (
        <p className="text-muted-foreground px-4 pb-4 text-center text-sm">
          Showing the first {MAX_PAGES} of {pages} pages. Download the file to
          see the rest.
        </p>
      ) : null}
    </>
  );
}

/**
 * docx-preview copies hyperlinks and embedded HTML straight from the file, so the document is drawn
 * inside a sandboxed frame: same origin so we can write into it, but no scripts, `javascript:` links,
 * popups or navigation of the hub. Frames nested inside inherit the sandbox.
 */
function WordDocument({ src, name }: { src: string; name: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { state } = useLoad(async (live) => {
    const [{ renderAsync }, data] = await Promise.all([
      import("docx-preview"),
      fetchBytes(src),
    ]);
    const doc = frame.current?.contentDocument;
    if (!(live() && doc)) {
      return;
    }
    await renderAsync(data, doc.body, doc.head, {
      breakPages: true,
      inWrapper: true,
      renderAltChunks: false,
    });
    // After rendering: renderAsync empties the head first.
    const style = doc.createElement("style");
    style.textContent = "body{margin:0}.docx-wrapper{background:none}";
    doc.head.append(style);
  });
  return (
    <>
      <Status state={state} />
      <iframe
        className={state === "ready" ? "block size-full" : "hidden"}
        ref={frame}
        sandbox="allow-same-origin"
        title={name}
      />
    </>
  );
}

interface Sheet {
  cut: boolean;
  name: string;
  rows: unknown[][];
}

function Spreadsheet({ src }: { src: string }) {
  const [active, setActive] = useState(0);
  const pick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) =>
      setActive(Number(event.currentTarget.dataset.index)),
    []
  );
  const { state, data } = useLoad(async () => {
    const [XLSX, buffer] = await Promise.all([import("xlsx"), fetchBytes(src)]);
    // sheetRows stops parsing at the limit; the range below caps columns of a wide CSV.
    const book = XLSX.read(buffer, { dense: true, sheetRows: MAX_ROWS });
    return book.SheetNames.map((name): Sheet => {
      const ws = book.Sheets[name];
      const full = XLSX.utils.decode_range(
        ws?.["!fullref"] ?? ws?.["!ref"] ?? "A1"
      );
      const rows = ws
        ? XLSX.utils.sheet_to_json<unknown[]>(ws, {
            blankrows: false,
            defval: "",
            header: 1,
            range: {
              e: {
                c: Math.min(full.e.c, MAX_COLS - 1),
                r: Math.min(full.e.r, MAX_ROWS - 1),
              },
              s: full.s,
            },
            raw: false,
          })
        : [];
      return {
        cut: full.e.r >= MAX_ROWS || full.e.c >= MAX_COLS,
        name,
        rows,
      };
    });
  });
  if (!data) {
    return <Status state={state} />;
  }
  const sheet = data[active] ?? data[0];
  const rows = sheet?.rows ?? [];
  const columns = Math.max(0, ...rows.map((row) => row.length));
  return (
    <div className="flex min-h-full flex-col">
      {data.length > 1 ? (
        <div className="border-border bg-background sticky top-0 z-20 flex gap-1 overflow-x-auto border-b p-1.5">
          {data.map((s, i) => (
            <Button
              data-index={i}
              key={s.name}
              onClick={pick}
              size="sm"
              variant={i === active ? "secondary" : "ghost"}
            >
              {s.name}
            </Button>
          ))}
        </div>
      ) : null}
      {rows.length ? null : <Message>This sheet is empty.</Message>}
      <table className="bg-background w-max border-collapse text-[13px] tabular-nums">
        <tbody>
          {rows.map((row, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position
            <tr key={r}>
              <th className="bg-muted text-muted-foreground border-border sticky left-0 border px-2 text-right font-normal">
                {r + 1}
              </th>
              {Array.from({ length: columns }, (_, c) => (
                <td
                  className="border-border max-w-80 truncate border px-2 py-1"
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells have no identity beyond their position
                  key={c}
                >
                  {String(row[c] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet?.cut ? (
        <p className="text-muted-foreground p-3 text-sm">
          Showing up to {MAX_ROWS} rows and {MAX_COLS} columns. Download the
          file to see the rest.
        </p>
      ) : null}
    </div>
  );
}

function PlainText({ src }: { src: string }) {
  const { state, data } = useLoad(async () =>
    new TextDecoder().decode(await fetchBytes(src))
  );
  if (data === undefined) {
    return <Status state={state} />;
  }
  return (
    <pre className="bg-background min-h-full p-4 font-mono text-[13px] leading-5 break-words whitespace-pre-wrap">
      {data}
    </pre>
  );
}
