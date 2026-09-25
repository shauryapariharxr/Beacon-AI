import { sql, type SQL } from "drizzle-orm";
import { db } from "./db";

// Read-only aggregation queries behind the admin panel. Kept out of the route
// so the route stays a thin auth + JSON wrapper (same split as rag.ts).
//
// The aggregate shapes (per-user counts, "the answer that followed this
// question") are far clearer as SQL than as several round-trips of Drizzle
// query-builder code, so these use `sql` templates with bound parameters —
// never string interpolation of user input.

export type AdminStats = {
  totalUsers: number;
  newUsers24h: number;
  newUsers7d: number;
  activeUsers24h: number;
  activeUsers7d: number;
  totalConversations: number;
  totalQuestions: number;
  totalReplies: number;
  questions24h: number;
  questions7d: number;
  totalDocuments: number;
  totalMemories: number;
};

export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  createdAt: number;
  conversations: number;
  questions: number;
  lastActiveAt: number | null;
};

export type AdminQuestionRow = {
  id: string;
  content: string;
  createdAt: number;
  conversationId: string;
  model: string;
  answer: string | null;
};

// The panel deliberately never loads a site-wide question feed: it lists
// people, and questions are fetched one user at a time (see
// getAdminUserQuestions).
export type AdminOverview = {
  stats: AdminStats;
  users: AdminUserRow[];
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * Drizzle's `execute` returns the driver's row list; postgres-js hands back a
 * plain array, but other drivers wrap rows in `{ rows }`. Normalize so this
 * keeps working if the driver is ever swapped.
 */
async function rawRows<T>(query: SQL): Promise<T[]> {
  const res: any = await db.execute(query);
  return (Array.isArray(res) ? res : res?.rows ?? []) as T[];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function getAdminStats(): Promise<AdminStats> {
  const now = Date.now();
  const since24h = now - DAY;
  const since7d = now - 7 * DAY;

  // One pass per table instead of the eleven independent scalar subqueries
  // this used to run: the old shape scanned `messages` five separate times
  // (total questions, total replies, 24h, 7d, plus two distinct-user joins)
  // on every admin page load, which grows linearly with the chat history —
  // a second per load at a million messages. FILTER aggregates collapse
  // those into a single scan each, and `created_at` is indexed so the 24h/7d
  // windows are a range scan rather than a full-table scan.
  //
  // Every field is cast with ::int, and the JS numbers come back as numbers.
  const rows = await rawRows<AdminStats>(sql`
    with u as (
      select
        count(*)::int as total,
        count(*) filter (where created_at > ${since24h}::bigint)::int as d1,
        count(*) filter (where created_at > ${since7d}::bigint)::int as d7
      from users
    ),
    conv as (
      select count(*)::int as total from conversations
    ),
    msg as (
      select
        count(*) filter (where role = 'user')::int as questions,
        count(*) filter (where role = 'assistant')::int as replies,
        count(*) filter (where role = 'user' and created_at > ${since24h}::bigint)::int as q1,
        count(*) filter (where role = 'user' and created_at > ${since7d}::bigint)::int as q7
      from messages
    ),
    act as (
      select
        count(distinct c.user_id) filter (where m.created_at > ${since24h}::bigint)::int as d1,
        count(distinct c.user_id)::int as d7
      from messages m
      join conversations c on c.id = m.conversation_id
      where m.created_at > ${since7d}::bigint
    ),
    doc as (select count(*)::int as total from documents),
    mem as (select count(*)::int as total from memories)
    select
      u.total as "totalUsers",
      u.d1 as "newUsers24h",
      u.d7 as "newUsers7d",
      act.d1 as "activeUsers24h",
      act.d7 as "activeUsers7d",
      conv.total as "totalConversations",
      msg.questions as "totalQuestions",
      msg.replies as "totalReplies",
      msg.q1 as "questions24h",
      msg.q7 as "questions7d",
      doc.total as "totalDocuments",
      mem.total as "totalMemories"
    from u, conv, msg, act, doc, mem
  `);

  return (
    rows[0] ?? {
      totalUsers: 0,
      newUsers24h: 0,
      newUsers7d: 0,
      activeUsers24h: 0,
      activeUsers7d: 0,
      totalConversations: 0,
      totalQuestions: 0,
      totalReplies: 0,
      questions24h: 0,
      questions7d: 0,
      totalDocuments: 0,
      totalMemories: 0,
    }
  );
}

/**
 * Postgres `int8`/bigint (our epoch-ms columns) comes back from postgres-js as
 * a STRING — the driver protects against precision loss — while the `::int`
 * casts in the stats query arrive as real numbers. Coerce here so the JSON the
 * panel receives is honestly typed and can go straight into `new Date(ms)`.
 */
function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * Every account, with how much it has actually used Beacon. `query` filters by
 * email or display name so the operator can find one person among many.
 */
export async function getAdminUsers(limit = 200, query = ""): Promise<AdminUserRow[]> {
  // Hard ceiling: the query aggregates the whole message history before it can
  // sort by last activity, so an unbounded page is a self-inflicted outage.
  const pageSize = Math.min(Math.max(1, Math.floor(limit)), 500);
  const trimmed = query.trim().slice(0, 120);
  const filter = trimmed
    ? sql`where u.email ilike ${"%" + escapeLike(trimmed) + "%"}
        or coalesce(u.name, '') ilike ${"%" + escapeLike(trimmed) + "%"}`
    : sql``;

  const rows = await rawRows<AdminUserRow>(sql`
    select
      u.id,
      u.email,
      u.name,
      u.created_at as "createdAt",
      coalesce(conv.conversation_count, 0)::int as "conversations",
      coalesce(act.question_count, 0)::int as "questions",
      act.last_message_at as "lastActiveAt"
    from users u
    left join (
      select user_id, count(*) as conversation_count
      from conversations
      group by user_id
    ) conv on conv.user_id = u.id
    left join (
      select
        c.user_id,
        count(*) filter (where m.role = 'user') as question_count,
        max(m.created_at) as last_message_at
      from messages m
      join conversations c on c.id = m.conversation_id
      group by c.user_id
    ) act on act.user_id = u.id
    ${filter}
    order by act.last_message_at desc nulls last, u.created_at desc
    limit ${pageSize}
  `);

  return rows.map((row) => ({
    ...row,
    createdAt: toNumber(row.createdAt),
    lastActiveAt: row.lastActiveAt == null ? null : toNumber(row.lastActiveAt),
  }));
}

/**
 * One account by id, or null when the id doesn't match a row. The id is
 * compared as text on purpose: that keeps a malformed id a clean "not found"
 * instead of a Postgres `invalid input syntax for type uuid` 500.
 */
export async function getAdminUser(id: string): Promise<AdminUserRow | null> {
  const rows = await rawRows<AdminUserRow>(sql`
    select
      u.id,
      u.email,
      u.name,
      u.created_at as "createdAt",
      coalesce(conv.conversation_count, 0)::int as "conversations",
      coalesce(act.question_count, 0)::int as "questions",
      act.last_message_at as "lastActiveAt"
    from users u
    left join (
      select user_id, count(*) as conversation_count
      from conversations
      group by user_id
    ) conv on conv.user_id = u.id
    left join (
      select
        c.user_id,
        count(*) filter (where m.role = 'user') as question_count,
        max(m.created_at) as last_message_at
      from messages m
      join conversations c on c.id = m.conversation_id
      group by c.user_id
    ) act on act.user_id = u.id
    where u.id::text = ${id}
    limit 1
  `);

  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    createdAt: toNumber(row.createdAt),
    lastActiveAt: row.lastActiveAt == null ? null : toNumber(row.lastActiveAt),
  };
}

/**
 * One user's questions, newest first, each paired with the answer that
 * followed it (via a lateral join, so one query covers both sides of the
 * exchange). `query` filters by question text.
 */
export async function getAdminUserQuestions(
  userId: string,
  query = "",
  limit = 100
): Promise<AdminQuestionRow[]> {
  const trimmed = query.trim().slice(0, 120);
  const filter = trimmed
    ? sql`and m.content ilike ${"%" + escapeLike(trimmed) + "%"}`
    : sql``;

  const rows = await rawRows<AdminQuestionRow>(sql`
    select
      m.id,
      m.content,
      m.created_at as "createdAt",
      c.id as "conversationId",
      c.model,
      a.content as "answer"
    from messages m
    join conversations c on c.id = m.conversation_id
    left join lateral (
      select m2.content
      from messages m2
      where m2.conversation_id = m.conversation_id
        and m2.role = 'assistant'
        and m2.created_at > m.created_at
      order by m2.created_at asc
      limit 1
    ) a on true
    where m.role = 'user'
      and c.user_id::text = ${userId}
    ${filter}
    order by m.created_at desc
    limit ${limit}
  `);

  return rows.map((row) => ({ ...row, createdAt: toNumber(row.createdAt) }));
}

export async function getAdminOverview(userQuery = ""): Promise<AdminOverview> {
  const [stats, users] = await Promise.all([getAdminStats(), getAdminUsers(200, userQuery)]);
  return { stats, users };
}
