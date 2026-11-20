// G 운영 준비(docs/v2-design/96): 사용량 카드(모두) · 관리 카드(관리자만 — 서버가 관리자라고 답할 때만 그린다).
// 설정 공용 Card·Row·CardMessage만 사용(95 계정 화면과 같은 모양). 한도 상태는 배지만(설명 글 없음).
import { useEffect, useState } from "react";
import type { AccountUsage, AdminAccount } from "../../platform";
import { formatBytes, STR } from "../../shared/strings";
import { IconLock, IconSuspend, IconTrash } from "../common/icons";
import { Card, CardMessage, Row } from "../settings/SettingsCard";
import { adminDeleteAccount, adminRegister, adminSet, loadUsage, useOnlineAccount } from "./onlineAccount";
import { DeleteConfirm } from "./DeleteConfirm";
import settings from "../settings/Settings.module.css";
import own from "./AccountPanel.module.css";

const A = STR.onlineSpaces.account;
const MB = 1024 * 1024;

/** 80% 넘으면 한도 임박, 넘으면 한도 초과 */
function level(used: number, limit: number | null): "ok" | "near" | "over" {
  if (limit === null) return "ok";
  if (used > limit) return "over";
  return limit > 0 && used / limit >= 0.8 ? "near" : "ok";
}
function LevelBadge({ used, limit }: { used: number; limit: number | null }) {
  const l = level(used, limit);
  if (l === "ok") return null;
  return (
    <span className={own.badge} data-tone={l} data-testid="usage-badge">
      {l === "over" ? A.over : A.near}
    </span>
  );
}
const bytes = (used: number, limit: number | null) =>
  limit === null ? `${formatBytes(used)} · ${A.unlimited}` : A.ofLimit(formatBytes(used), formatBytes(limit));
function UsageGauge({
  label,
  used,
  limit,
  count = false,
  testId,
}: {
  label: string;
  used: number;
  limit: number | null;
  count?: boolean;
  testId?: string;
}) {
  const value = count
    ? limit === null
      ? A.countOf(used, limit) + " · " + A.unlimited
      : A.countOf(used, limit)
    : bytes(used, limit);
  const percent =
    limit === null ? 0 : limit === 0 ? (used > 0 ? 100 : 0) : Math.min(100, (used / limit) * 100);
  return (
    <span className={own.gauge} data-tone={level(used, limit)}>
      <span className={own.gaugeLabel}>
        {label} <LevelBadge used={used} limit={limit} />
      </span>
      {limit === null ? (
        <span className={own.gaugeTrack} data-unlimited aria-hidden="true" />
      ) : (
        <span
          className={own.gaugeTrack}
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={value}
        >
          <span className={own.gaugeFill} style={{ width: percent + "%" }} />
        </span>
      )}
      <span className={own.gaugeValue} data-testid={testId}>
        {value}
      </span>
    </span>
  );
}

function AccountGauges({ usage, testPrefix }: { usage: AccountUsage; testPrefix?: string }) {
  const { used, limits } = usage;
  return (
    <span className={own.gauges}>
      <UsageGauge
        label={A.images}
        used={used.images}
        limit={limits.images}
        testId={testPrefix && testPrefix + "-images"}
      />
      <UsageGauge
        label={A.spaces}
        used={used.spaces}
        limit={limits.spaces}
        count
        testId={testPrefix && testPrefix + "-spaces"}
      />
      <UsageGauge
        label={A.records}
        used={used.records}
        limit={limits.records}
        testId={testPrefix && testPrefix + "-records"}
      />
    </span>
  );
}

export function UsageCard() {
  const usage = useOnlineAccount((s) => s.usage);
  const signedIn = useOnlineAccount((s) => s.status?.state === "signedIn");
  useEffect(() => {
    if (signedIn) void loadUsage();
  }, [signedIn]);
  if (!usage) return null;
  return (
    <Card
      id="online-usage"
      title={A.usageTitle}
      desc={
        usage.suspended ? (
          <span className={own.badge} data-tone="over">
            {A.suspended}
          </span>
        ) : usage.unlimited ? (
          <span className={own.badge}>{A.unlimited}</span>
        ) : undefined
      }
      testId="usage-card"
    >
      <div className={own.gaugeSection}>
        <AccountGauges usage={usage} testPrefix="usage" />
      </div>
    </Card>
  );
}

export function AdminCard() {
  const { usage, admin, adminError } = useOnlineAccount();
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [registering, setRegistering] = useState(false);
  if (!usage?.admin) return null;
  const p = usage.project;
  return (
    <Card
      id="online-admin"
      title={A.adminTitle}
      desc={<span className={own.badge}>{A.adminBadge}</span>}
      testId="admin-card"
    >
      {p && (
        <section className={own.gaugeSection} aria-labelledby="online-project-usage">
          <h4 className={own.gaugeTitle} id="online-project-usage">
            {A.projectUsage}
          </h4>
          <span className={own.gauges}>
            <UsageGauge
              label={A.projectImages}
              used={p.images}
              limit={p.imagesLimit}
              testId="admin-project-images"
            />
            <UsageGauge label={A.projectDb} used={p.db} limit={p.dbLimit} testId="admin-project-db" />
          </span>
        </section>
      )}
      <form
        className={own.registration}
        onSubmit={(e) => {
          e.preventDefault();
          if (registering || !email.trim()) return;
          setRegistering(true);
          void adminRegister(email)
            .then((ok) => {
              setRegistered(ok);
              if (ok) setEmail("");
            })
            .finally(() => setRegistering(false));
        }}
      >
        <label htmlFor="admin-invite-input">{A.registerEmail}</label>
        <div className={own.registerControls}>
          <input
            id="admin-invite-input"
            className={own.input}
            type="email"
            required
            placeholder={A.registerPlaceholder}
            disabled={registering}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setRegistered(false);
            }}
            data-testid="admin-invite-input"
          />
          <button type="submit" disabled={!email.trim() || registering} data-testid="admin-invite">
            {A.register}
          </button>
        </div>
        {registered && <span role="status">{A.registerDone}</span>}
      </form>
      {(admin ?? []).map((a) => (
        <AccountRow
          key={a.userId}
          a={a}
          editing={editing === a.userId}
          onEdit={(on) => setEditing(on ? a.userId : null)}
        />
      ))}
      {adminError && (
        <CardMessage>
          <p className={own.error} role="alert" data-testid="admin-error">
            {adminError}
          </p>
        </CardMessage>
      )}
    </Card>
  );
}

function AccountRow({
  a,
  editing,
  onEdit,
}: {
  a: AdminAccount;
  editing: boolean;
  onEdit: (on: boolean) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <Row
        className={own.adminRow}
        label={
          <span data-testid="admin-account" data-user={a.userId}>
            {a.email ?? a.userId.slice(0, 8)} {a.admin && <span className={own.badge}>{A.adminBadge}</span>}
            {!a.admin && a.unlimited && <span className={own.badge}>{A.unlimited}</span>}
            {a.suspended && (
              <span className={own.badge} data-tone="over">
                {A.suspended}
              </span>
            )}
            {!a.admin && a.custom && !a.unlimited && <span className={own.badge}>{A.custom}</span>}
          </span>
        }
        details={<AccountGauges usage={a} />}
      >
        {!a.admin && (
          <>
            <button type="button" onClick={() => onEdit(!editing)} data-testid="admin-edit">
              {A.editLimits}
            </button>
            <button
              type="button"
              onClick={() =>
                void (a.unlimited
                  ? adminSet(a.userId, { reset: true })
                  : adminSet(a.userId, { unlimited: true }))
              }
              data-testid="admin-unlimited"
            >
              {a.unlimited ? A.makeDefault : A.makeUnlimited}
            </button>
            <button
              type="button"
              className={`${own.iconAction} ${a.suspended ? "" : own.dangerAction}`}
              onClick={() => void adminSet(a.userId, { suspended: !a.suspended })}
              data-testid="admin-suspend"
            >
              {a.suspended ? <IconLock open /> : <IconSuspend />}
              {a.suspended ? A.unsuspend : A.suspend}
            </button>
            <button
              type="button"
              className={`${own.iconAction} ${own.dangerAction}`}
              onClick={() => setDeleting(!deleting)}
              data-testid="admin-delete"
            >
              <IconTrash />
              {A.deleteAccount}
            </button>
          </>
        )}
      </Row>
      {editing && <LimitEdit a={a} onDone={() => onEdit(false)} />}
      {deleting && !a.admin && (
        <DeleteConfirm
          title={A.adminDeleteTitle(a.email ?? a.userId.slice(0, 8))}
          body={A.adminDeleteBody}
          expect={a.email ?? a.userId}
          okLabel={A.deleteOk}
          testId="admin-delete-confirm"
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            if (!(await adminDeleteAccount(a.userId))) return useOnlineAccount.getState().adminError;
            setDeleting(false);
            return null;
          }}
        />
      )}
    </>
  );
}

/** 한도 바꾸기(행 자리에 펼침) — 빈 칸 = 기본값 */
function LimitEdit({ a, onDone }: { a: AdminAccount; onDone: () => void }) {
  const mb = (v: number | null) => (v === null ? "" : String(Math.round(v / MB)));
  const [images, setImages] = useState(mb(a.limits.images));
  const [spaces, setSpaces] = useState(a.limits.spaces === null ? "" : String(a.limits.spaces));
  const [records, setRecords] = useState(mb(a.limits.records));
  const num = (v: string, scale: number) =>
    v.trim() === "" ? null : Math.max(0, Math.round(Number(v) * scale));
  const valid = [images, spaces, records].every((v) => v.trim() === "" || /^\d+$/.test(v.trim()));
  // C(96): 지금 사용량보다 낮게 줄이면 한 번 확인 — 이미 있는 것은 그대로, 새로 늘리는 것만 막힌다
  const below = [
    [num(images, MB), a.used.images, A.images],
    [num(spaces, 1), a.used.spaces, A.spaces],
    [num(records, MB), a.used.records, A.records],
  ].flatMap(([v, used, name]) => (v !== null && (v as number) < (used as number) ? [name as string] : []));
  const [warn, setWarn] = useState(false);
  const change = (f: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    f(e.target.value);
    setWarn(false);
  };
  return (
    <form
      className={own.confirm}
      data-testid="admin-limit-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (below.length && !warn) return setWarn(true);
        void adminSet(a.userId, {
          unlimited: false,
          images: num(images, MB),
          spaces: num(spaces, 1),
          records: num(records, MB),
        }).then(onDone);
      }}
    >
      <span className={own.limitFields}>
        <label>
          {A.limitImagesMb}
          <input
            className={own.input}
            inputMode="numeric"
            value={images}
            onChange={change(setImages)}
            data-testid="limit-images"
          />
        </label>
        <label>
          {A.limitSpaces}
          <input
            className={own.input}
            inputMode="numeric"
            value={spaces}
            onChange={change(setSpaces)}
            data-testid="limit-spaces"
          />
        </label>
        <label>
          {A.limitRecordsMb}
          <input
            className={own.input}
            inputMode="numeric"
            value={records}
            onChange={change(setRecords)}
            data-testid="limit-records"
          />
        </label>
        {warn && (
          <span className={own.limitWarn} role="alert" data-testid="limit-below-warning">
            {A.limitBelow(below.join(" · "))}
          </span>
        )}
      </span>
      <span className={own.confirmButtons}>
        <button type="button" onClick={onDone}>
          {A.cancel}
        </button>
        <button type="submit" className={settings.primary} disabled={!valid} data-testid="limit-save">
          {warn ? A.saveAnyway : A.save}
        </button>
      </span>
    </form>
  );
}
