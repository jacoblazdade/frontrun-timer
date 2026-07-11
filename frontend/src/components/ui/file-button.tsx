// Styled file picker: a real button + hidden native input, showing the chosen
// filename. Replaces the browser's default "Choose File" control.
import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

export function FileButton({
  accept,
  onFile,
  label = "Datei wählen",
  className,
}: {
  accept?: string;
  onFile: (file: File | null) => void;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setName(f?.name ?? null);
          onFile(f);
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-2 rounded-md bg-secondary px-3.5 py-2 text-sm font-semibold text-secondary-foreground hover:brightness-110"
      >
        <Upload className="h-4 w-4" />
        {label}
      </button>
      <span className="text-sm text-muted-foreground">
        {name ?? "Keine Datei ausgewählt"}
      </span>
    </div>
  );
}
