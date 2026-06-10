import { ulid } from "ulidx";

/** ULID primary keys: sortable, globally unique — makes cross-DB copies idempotent. */
export function newId(): string {
  return ulid();
}
