"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, X, FileText, Image as ImageIcon, Music, FileSpreadsheet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RA_ATTACHMENT_LIMITS,
  validateRaAttachments,
  type AttachmentValidationError,
} from "@/lib/reclameaqui/attachments";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RaFileUploadProps {
  onChange: (files: File[]) => void;
  maxFiles?: number;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCEPT = RA_ATTACHMENT_LIMITS.acceptedExtensions.map((e) => `.${e}`).join(",");

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(file: File) {
  if (file.type.startsWith("image/")) return <ImageIcon className="h-4 w-4 text-blue-500" />;
  if (file.type.startsWith("audio/")) return <Music className="h-4 w-4 text-purple-500" />;
  if (file.type.includes("spreadsheet") || file.type.includes("excel") || file.type === "text/csv")
    return <FileSpreadsheet className="h-4 w-4 text-green-500" />;
  return <FileText className="h-4 w-4 text-gray-500" />;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RaFileUpload({ onChange, maxFiles, disabled }: RaFileUploadProps) {
  const max = maxFiles ?? RA_ATTACHMENT_LIMITS.maxFiles;
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<AttachmentValidationError[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());

  const addFiles = useCallback(
    (incoming: File[]) => {
      const next = [...files, ...incoming];
      const validationErrors = validateRaAttachments(next);
      setErrors(validationErrors);

      if (validationErrors.length === 0) {
        setFiles(next);
        onChange(next);

        // Generate image previews
        for (const f of incoming) {
          if (isImageFile(f)) {
            const url = URL.createObjectURL(f);
            setPreviews((prev) => new Map(prev).set(f.name + f.size, url));
          }
        }
      } else {
        // Still show the errors but don't update files if global error
        const hasGlobalError = validationErrors.some((e) => e.file === "*");
        if (!hasGlobalError) {
          // Filter out bad files, keep good ones
          const badFiles = new Set(validationErrors.map((e) => e.file));
          const good = next.filter((f) => !badFiles.has(f.name));
          setFiles(good);
          onChange(good);

          for (const f of incoming) {
            if (isImageFile(f) && !badFiles.has(f.name)) {
              const url = URL.createObjectURL(f);
              setPreviews((prev) => new Map(prev).set(f.name + f.size, url));
            }
          }
        }
      }
    },
    [files, onChange]
  );

  const removeFile = useCallback(
    (index: number) => {
      const removed = files[index];
      const next = files.filter((_, i) => i !== index);
      setFiles(next);
      setErrors(validateRaAttachments(next));
      onChange(next);

      if (removed) {
        const key = removed.name + removed.size;
        const url = previews.get(key);
        if (url) {
          URL.revokeObjectURL(url);
          setPreviews((prev) => {
            const copy = new Map(prev);
            copy.delete(key);
            return copy;
          });
        }
      }
    },
    [files, onChange, previews]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length) addFiles(dropped);
    },
    [addFiles, disabled]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? []);
      if (selected.length) addFiles(selected);
      // Reset so same file can be re-selected
      e.target.value = "";
    },
    [addFiles]
  );

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <Card
        className={`relative cursor-pointer border-2 border-dashed transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <div className="flex flex-col items-center justify-center py-4 px-3 gap-1.5">
          <Upload className="h-5 w-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground text-center">
            Arraste arquivos ou clique para selecionar
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            Máx {max} arquivos · Áudio ≤{RA_ATTACHMENT_LIMITS.maxAudioSizeMB}MB · Outros ≤
            {RA_ATTACHMENT_LIMITS.maxOtherSizeMB}MB
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled}
        />
      </Card>

      {/* Global errors */}
      {errors
        .filter((e) => e.file === "*")
        .map((e, i) => (
          <p key={i} className="text-xs text-red-600">
            {e.reason}
          </p>
        ))}

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((file, index) => {
            const key = file.name + file.size;
            const preview = previews.get(key);
            const fileError = errors.find((e) => e.file === file.name);

            return (
              <div
                key={key}
                className={`flex items-center gap-2 rounded-md border p-2 text-sm ${
                  fileError ? "border-red-300 bg-red-50" : "border-border"
                }`}
              >
                {/* Preview or icon */}
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview}
                    alt={file.name}
                    className="h-8 w-8 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-muted flex-shrink-0">
                    {getFileIcon(file)}
                  </div>
                )}

                {/* Name + size */}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium">{file.name}</p>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                      {formatSize(file.size)}
                    </Badge>
                    {fileError && (
                      <span className="text-[10px] text-red-600">{fileError.reason}</span>
                    )}
                  </div>
                </div>

                {/* Remove */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                  disabled={disabled}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RaFileUpload;
