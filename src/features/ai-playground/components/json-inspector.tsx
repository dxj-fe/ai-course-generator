"use client";

type JsonInspectorProps = {
  error?: string;
  placeholder: string;
  value?: unknown;
};

export function JsonInspector({ error, placeholder, value }: JsonInspectorProps) {
  const content = error
    ? error
    : value === undefined
      ? placeholder
      : JSON.stringify(value, null, 2);

  return (
    <pre className="min-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-[#f1f5f9] p-3 text-sm leading-6 text-[#172033]">
      {content}
    </pre>
  );
}
