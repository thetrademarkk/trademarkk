import "server-only";
import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql";
import { serverEnv } from "../env";
import * as schema from "./platform-schema";

const client = createClient({
  url: serverEnv.platformDbUrl.replace(/^libsql:\/\//, "https://"),
  authToken: serverEnv.platformDbToken,
});

export const platformDb = drizzle(client, { schema });
