"use client";

import { Download, Eye, FileText } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useCallback, useState } from "react";
import {
  FilePreviewDialog,
  previewKind,
} from "@/components/file-preview-dialog";
import { PdfPreview } from "@/components/pdf-preview";
import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Button, buttonVariants } from "@/components/ui/button";

const size = (bytes: number) =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Images, PDF and video preview in place; anything the modal can draw opens there (spec 2). */
export function FileCard({
  fileId,
  name,
  contentType,
  size: bytes,
}: {
  fileId: string;
  name: string;
  contentType: string;
  size: number;
}) {
  const [open, setOpen] = useState(false);
  const file = { contentType, id: fileId, name, size: bytes };
  const canPreview = previewKind(file) !== null;
  const src = `/api/files/${fileId}`;
  const show = useCallback(() => setOpen(true), []);
  let preview: ReactNode = null;
  if (contentType.startsWith("image/")) {
    preview = (
      <button
        aria-label={`Open ${name}`}
        className="block w-full cursor-zoom-in"
        onClick={show}
        type="button"
      >
        <Image
          alt={name}
          className="h-auto max-h-96 w-full bg-black object-contain"
          decoding="async"
          height={384}
          loading="lazy"
          src={src}
          unoptimized
          width={448}
        />
      </button>
    );
  } else if (contentType === "application/pdf") {
    preview = <PdfPreview name={name} onOpen={show} src={src} />;
  } else if (contentType.startsWith("video/")) {
    preview = <VideoPreview src={src} />;
  }

  return (
    <figure className="border-border w-full max-w-md overflow-hidden rounded-lg border">
      {preview}
      <figcaption>
        <Attachment className="w-full border-0">
          <AttachmentMedia>
            <FileText aria-hidden="true" />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{name}</AttachmentTitle>
            <AttachmentDescription className="tabular-nums">
              {size(bytes)}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            {canPreview ? (
              <Button onClick={show} size="sm" type="button" variant="ghost">
                <Eye aria-hidden="true" />
                Preview
              </Button>
            ) : null}
            <a
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              download={name}
              href={`${src}?download`}
            >
              <Download aria-hidden="true" />
              Download
            </a>
          </AttachmentActions>
        </Attachment>
      </figcaption>
      <FilePreviewDialog file={open ? file : null} onOpenChange={setOpen} />
    </figure>
  );
}

function VideoPreview({ src }: { src: string }) {
  return (
    <>
      {/* biome-ignore lint/a11y/useMediaCaption: the file API exposes no caption track to attach */}
      <video
        className="max-h-96 w-full bg-black"
        controls
        preload="metadata"
        src={src}
      />
    </>
  );
}
