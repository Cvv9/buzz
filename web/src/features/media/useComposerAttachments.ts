import * as React from "react";
import { uploadBrowserMedia } from "./browser-media";
import {
  type MediaDescriptor,
  isPreviewableMedia,
  mediaType,
  validateMediaFile,
} from "./media-policy";

export type ComposerAttachment = {
  id: string;
  file: File;
  previewUrl?: string;
  progress: number;
  status: "uploading" | "ready" | "error";
  descriptor?: MediaDescriptor;
  error?: string;
};

function attachmentId(): string {
  return crypto.randomUUID();
}

/**
 * Owns browser object URLs and the short-lived BUD upload work for a composer.
 * It intentionally keeps pending bytes out of React Query and durable caches.
 */
export function useComposerAttachments() {
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>(
    [],
  );
  const abortControllers = React.useRef(new Map<string, AbortController>());
  const previewUrls = React.useRef(new Map<string, string>());

  const revokePreview = React.useCallback((id: string) => {
    const url = previewUrls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    previewUrls.current.delete(id);
  }, []);

  React.useEffect(
    () => () => {
      for (const controller of abortControllers.current.values()) {
        controller.abort();
      }
      for (const url of previewUrls.current.values()) URL.revokeObjectURL(url);
      abortControllers.current.clear();
      previewUrls.current.clear();
    },
    [],
  );

  const upload = React.useCallback(async (id: string, file: File) => {
    const controller = new AbortController();
    abortControllers.current.set(id, controller);
    try {
      const descriptor = await uploadBrowserMedia(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          setAttachments((current) =>
            current.map((attachment) =>
              attachment.id === id ? { ...attachment, progress } : attachment,
            ),
          );
        },
      });
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === id
            ? { ...attachment, descriptor, progress: 100, status: "ready" }
            : attachment,
        ),
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === id
            ? {
                ...attachment,
                status: "error",
                error:
                  error instanceof Error
                    ? error.message
                    : "The attachment could not be uploaded.",
              }
            : attachment,
        ),
      );
    } finally {
      abortControllers.current.delete(id);
    }
  }, []);

  const addFiles = React.useCallback(
    (files: Iterable<File>): string[] => {
      const accepted: Array<{ id: string; file: File; previewUrl?: string }> =
        [];
      const errors: string[] = [];
      for (const file of files) {
        const validation = validateMediaFile(file);
        if (validation) {
          errors.push(`${file.name || "Attachment"}: ${validation}`);
          continue;
        }
        const id = attachmentId();
        const type = mediaType(file);
        const previewUrl = isPreviewableMedia(type)
          ? URL.createObjectURL(file)
          : undefined;
        if (previewUrl) previewUrls.current.set(id, previewUrl);
        accepted.push({ id, file, previewUrl });
      }
      if (accepted.length) {
        setAttachments((current) => [
          ...current,
          ...accepted.map(({ id, file, previewUrl }) => ({
            id,
            file,
            previewUrl,
            progress: 0,
            status: "uploading" as const,
          })),
        ]);
        for (const attachment of accepted) {
          void upload(attachment.id, attachment.file);
        }
      }
      return errors;
    },
    [upload],
  );

  const remove = React.useCallback(
    (id: string) => {
      abortControllers.current.get(id)?.abort();
      abortControllers.current.delete(id);
      revokePreview(id);
      setAttachments((current) =>
        current.filter((attachment) => attachment.id !== id),
      );
    },
    [revokePreview],
  );

  const retry = React.useCallback(
    (id: string) => {
      const attachment = attachments.find((candidate) => candidate.id === id);
      if (attachment?.status !== "error") return;
      setAttachments((current) =>
        current.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                error: undefined,
                progress: 0,
                status: "uploading",
              }
            : candidate,
        ),
      );
      void upload(id, attachment.file);
    },
    [attachments, upload],
  );

  const clear = React.useCallback(() => {
    for (const attachment of attachments) {
      abortControllers.current.get(attachment.id)?.abort();
      revokePreview(attachment.id);
    }
    abortControllers.current.clear();
    setAttachments([]);
  }, [attachments, revokePreview]);

  const readyAttachments = React.useMemo(
    () =>
      attachments.flatMap((attachment) =>
        attachment.status === "ready" && attachment.descriptor
          ? [attachment.descriptor]
          : [],
      ),
    [attachments],
  );

  return {
    addFiles,
    attachments,
    clear,
    hasFailed: attachments.some((attachment) => attachment.status === "error"),
    hasUploading: attachments.some(
      (attachment) => attachment.status === "uploading",
    ),
    readyAttachments,
    remove,
    retry,
  };
}
