"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface PromptListEditorProps {
  prompts: string[];
  onChange: (next: string[]) => void;
  addLabel?: string;
  rows?: number;
}

export function PromptListEditor({
  prompts,
  onChange,
  addLabel = "+ Add variation",
  rows = 3,
}: PromptListEditorProps) {
  function update(i: number, value: string) {
    const next = [...prompts];
    next[i] = value;
    onChange(next);
  }
  function remove(i: number) {
    onChange(prompts.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...prompts, ""]);
  }
  return (
    <div className="space-y-2">
      {prompts.map((prompt, i) => (
        <div key={i} className="flex gap-2">
          <Textarea
            rows={rows}
            value={prompt}
            onChange={(e) => update(i, e.target.value)}
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => remove(i)}
            disabled={prompts.length <= 1}
            aria-label="Remove"
          >
            ×
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={add}>
        {addLabel}
      </Button>
    </div>
  );
}
