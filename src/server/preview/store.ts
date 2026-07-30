import {
  createGeneratedHtmlPreviewRecord,
  parseGeneratedHtmlPreviewRecord,
  type GeneratedHtmlPreviewInput,
  type GeneratedHtmlPreviewRecord,
} from "@/shared/html-preview";
import { getAppDatabase } from "@/server/infra/database/connection";

export type HtmlPreviewStore = {
  load(id: string): Promise<GeneratedHtmlPreviewRecord | undefined>;
  save(input: GeneratedHtmlPreviewInput): Promise<GeneratedHtmlPreviewRecord>;
};

export function createHtmlPreviewStore(databasePath?: string): HtmlPreviewStore {
  const database = getAppDatabase(databasePath);
  const load = database.prepare(
    "SELECT payload, expires_at FROM html_previews WHERE id = ?",
  );
  const remove = database.prepare("DELETE FROM html_previews WHERE id = ?");
  const save = database.prepare(`
    INSERT INTO html_previews (id, payload, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `);

  return {
    async load(id) {
      if (!/^[a-f0-9-]{36}$/.test(id)) return undefined;
      const row = load.get(id) as
        | { payload: string; expires_at: string }
        | undefined;
      if (!row) return undefined;
      if (Date.parse(row.expires_at) <= Date.now()) {
        remove.run(id);
        return undefined;
      }
      try {
        const record = parseGeneratedHtmlPreviewRecord(
          JSON.parse(row.payload),
        );
        return record.id === id ? record : undefined;
      } catch {
        return undefined;
      }
    },

    async save(input) {
      const record = createGeneratedHtmlPreviewRecord(input);
      save.run(
        record.id,
        JSON.stringify(record),
        record.createdAt,
        record.expiresAt,
      );
      return record;
    },
  };
}
