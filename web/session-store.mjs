/* global Buffer, URL */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  X509Certificate,
} from "node:crypto";
import { getCACertificates } from "node:tls";
import postgres from "postgres";

export function connectWebDatabase(
  connectionString,
  { projectRef, allowLocal = false, certificate, production = false },
) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw Error("DEV_WEB_DATABASE_REQUIRED");
  }
  const local = allowLocal && ["127.0.0.1", "localhost"].includes(url.hostname);
  const role = production ? "wj_web_live" : "wj_web_app";
  const validRole = local
    ? url.username === role
    : url.username === role + "." + projectRef &&
      url.hostname.endsWith(".pooler.supabase.com") &&
      url.port === "6543" &&
      url.pathname === "/postgres";
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !validRole ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw Error("DEV_WEB_DATABASE_REQUIRED");
  }
  let ssl = false;
  if (!local) {
    try {
      if (!new X509Certificate(certificate).ca) throw Error();
    } catch {
      throw Error("DEV_WEB_DATABASE_CA_REQUIRED");
    }
    ssl = { ca: [...getCACertificates("default"), certificate], rejectUnauthorized: true };
  }
  return postgres(url.href, {
    ssl,
    prepare: false,
    max: 2,
    connect_timeout: 5,
    idle_timeout: 15,
  });
}

export function createSessionStore(sql, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error("DEV_SESSION_ENCRYPTION_KEY_REQUIRED");
  const indexKey = Buffer.from(hkdfSync("sha256", key, "", "wj-web-index-v1", 32));
  const tokenKey = Buffer.from(hkdfSync("sha256", key, "", "wj-web-payload-v1", 32));
  const index = (scope, raw) =>
    createHmac("sha256", indexKey)
      .update(scope + ":" + raw)
      .digest("hex");

  function encrypt(id, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", tokenKey, iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
  }

  function decode(id, row) {
    if (!row) return null;
    const bytes = Buffer.from(row.payload, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", tokenKey, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(id));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
    return { value, generation: row.generation, refreshing: Boolean(row.lock_owner) };
  }

  return {
    async putChallenge(raw, value, seconds) {
      const id = index("challenge", raw);
      await sql`
        insert into wj_web.otp_challenge (id, payload, expires_at)
        values (${id}, ${encrypt(id, value)}, now() + ${seconds} * interval '1 second')
      `;
    },
    async getChallenge(raw) {
      const id = index("challenge", raw);
      const [row] = await sql`
        select payload from wj_web.otp_challenge where id = ${id} and expires_at > now()
      `;
      return decode(id, row)?.value ?? null;
    },
    async takeChallenge(raw) {
      const id = index("challenge", raw);
      const [row] = await sql`
        delete from wj_web.otp_challenge where id = ${id} and expires_at > now() returning payload
      `;
      return decode(id, row)?.value ?? null;
    },
    async limit(scope, raw, seconds) {
      const id = index(scope, raw);
      const [row] = await sql`
        insert into wj_web.auth_rate_limit as prior (id, hits, expires_at)
        values (${id}, 1, now() + ${seconds} * interval '1 second')
        on conflict (id) do update set
          hits = case when prior.expires_at <= clock_timestamp() then 1 else prior.hits + 1 end,
          expires_at = case when prior.expires_at <= clock_timestamp()
            then clock_timestamp() + ${seconds} * interval '1 second' else prior.expires_at end
        returning hits
      `;
      return row.hits;
    },
    async saveLogin(raw, value, seconds) {
      const id = index("session", raw);
      const payload = encrypt(id, value);
      await sql.begin(async (tx) => {
        await tx`
          insert into wj_web.consent (account_id, terms_version)
          values (${value.accountId}, ${value.termsVersion})
          on conflict (account_id, terms_version) do nothing
        `;
        await tx`
          insert into wj_web.session (id, account_id, payload, expires_at)
          values (${id}, ${value.accountId}, ${payload}, now() + ${seconds} * interval '1 second')
        `;
      });
    },
    async getSession(raw) {
      const id = index("session", raw);
      const [row] = await sql`
        select payload, generation, lock_owner
        from wj_web.session where id = ${id} and expires_at > now()
      `;
      return decode(id, row);
    },
    async takeSession(raw) {
      const id = index("session", raw);
      const [row] = await sql`
        delete from wj_web.session where id = ${id} returning payload, generation, lock_owner
      `;
      return decode(id, row);
    },
    async claimRefresh(raw, generation, lock) {
      const [row] = await sql`
        update wj_web.session set lock_owner = ${lock}, lock_until = now() + interval '75 seconds'
        where id = ${index("session", raw)} and generation = ${generation}
          and expires_at > now() and lock_owner is null
        returning id
      `;
      return Boolean(row);
    },
    async expireRefresh(raw, generation) {
      const [row] = await sql`
        delete from wj_web.session
        where id = ${index("session", raw)} and generation = ${generation}
          and lock_until <= now()
        returning id
      `;
      return Boolean(row);
    },
    async finishRefresh(raw, generation, lock, value) {
      const id = index("session", raw);
      const [row] = await sql`
        update wj_web.session
        set payload = ${encrypt(id, value)}, generation = generation + 1, lock_owner = null, lock_until = null
        where id = ${id} and generation = ${generation} and lock_owner = ${lock}
          and lock_until > now() and expires_at > now()
        returning generation
      `;
      return row ? { value, generation: row.generation, refreshing: false } : null;
    },
    async dropSession(raw, generation) {
      const [row] = await sql`
        delete from wj_web.session where id = ${index("session", raw)} and generation = ${generation}
        returning id
      `;
      return Boolean(row);
    },
  };
}
