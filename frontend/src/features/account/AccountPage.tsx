import {
  Check,
  Copy,
  HardDrive,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Card, Skeleton } from "../../components/ui/misc";
import { Page, PageHeader } from "../../components/ui/Page";
import { Segmented } from "../../components/ui/Segmented";
import {
  useAccount,
  useDeleteAccount,
  useLogoutAll,
  useSignIn,
  useSignOut,
} from "../../hooks/data";
import { api, ApiError } from "../../lib/api";

const errorText = (t: (k: string) => string, e: unknown) =>
  t(`errors.${e instanceof ApiError ? e.code : "unknown"}`);

const inputClass =
  "h-10 rounded-lg border border-border bg-surface px-3 text-sm font-normal";

/**
 * 계정. 비회원은 프로필이 이 브라우저에만 저장되고, 회원은 어느 기기에서나 같은 프로필을 쓴다.
 * 아이디·비밀번호만 받는다 (이메일 등 다른 개인정보 없음). 비밀번호를 잊으면 가입 때 받은 복구 코드로 되찾는다.
 */
export function AccountPage() {
  const { t } = useTranslation();
  const { account, isLoading } = useAccount();
  // 가입·복구 직후 한 번만 보여 줄 복구 코드
  const [code, setCode] = useState<string | null>(null);
  return (
    <Page width="form">
      <PageHeader title={t("account.title")} />
      {isLoading ? (
        <Skeleton className="h-80" />
      ) : code ? (
        <RecoveryCodeCard code={code} onDone={() => setCode(null)} />
      ) : account ? (
        <SignedIn username={account.username} onNewCode={setCode} />
      ) : (
        <SignInForm onCode={setCode} />
      )}
    </Page>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

/** 새 비밀번호를 한 번 더 받는 칸. 둘 다 입력했는데 다르면 바로 알려 준다 */
function ConfirmField({
  label,
  value,
  password,
  onChange,
}: {
  label: string;
  value: string;
  password: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const differs = value !== "" && value !== password;
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="new-password"
        required
        aria-invalid={differs}
        className={inputClass + (differs ? " border-bad" : "")}
      />
      <span className={"text-xs font-normal " + (differs ? "text-bad" : "text-muted")}>
        {differs ? t("errors.password_mismatch") : t("account.passwordConfirmHint")}
      </span>
    </label>
  );
}

/** 오류 줄은 자리를 잡아 둔다 (나타날 때 버튼이 밀리지 않게) */
function ErrorLine({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return (
    <p role="alert" className="min-h-5 text-sm text-bad">
      {error ? errorText(t, error) : ""}
    </p>
  );
}

/** 복구 코드: 지금 한 번만 보여 준다. 저장했다고 확인해야 넘어간다 */
function RecoveryCodeCard({
  code,
  onDone,
}: {
  code: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <Card className="flex flex-col gap-4 border-accent/50 p-5">
      <p className="flex items-center gap-2 text-lg font-semibold">
        <KeyRound className="size-5 text-accent" />
        {t("account.recoveryTitle")}
      </p>
      <p className="text-sm text-muted">{t("account.recoveryExplain")}</p>
      <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-3">
        <code className="flex-1 text-center font-mono text-lg font-bold tracking-wider select-all">
          {code}
        </code>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("account.copy")}
          onClick={() =>
            navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => toast.error(t("account.copyFailed")),
            )
          }
        >
          {copied ? (
            <Check className="size-4 text-good" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        {t("account.recoverySaved")}
      </label>
      <Button
        variant="primary"
        className="justify-center"
        disabled={!saved}
        onClick={() => {
          onDone();
          navigate("/");
        }}
      >
        {t("account.continue")}
      </Button>
    </Card>
  );
}

function SignInForm({ onCode }: { onCode: (code: string) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup" | "recover">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [website, setWebsite] = useState(""); // 봇 걸러내기용 숨은 칸
  const signIn = useSignIn();

  const switchMode = (m: typeof mode) => {
    setMode(m);
    setPassword("");
    setConfirm("");
    signIn.reset();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // 다르면 확인칸 밑에 이미 빨갛게 보이므로 보내지만 않는다
    if (mode !== "login" && password !== confirm) return;
    signIn.mutate(
      { mode, username: username.trim(), password, website, recoveryCode },
      {
        onSuccess: ({ account, imported, recoveryCode: code }) => {
          const key = {
            login: "account.welcomeBack",
            signup: "account.welcome",
            recover: "account.recovered",
          }[mode];
          toast.success(t(key, { name: account.username }));
          if (imported) toast(t("account.imported", { n: imported }));
          if (code) onCode(code);
          else navigate("/");
        },
      },
    );
  };

  const submitLabel = {
    login: "account.login",
    signup: "account.signup",
    recover: "account.recoverSubmit",
  }[mode];

  return (
    <>
      <Card className="flex flex-col gap-4 p-5">
        {mode === "recover" ? (
          <p className="flex items-center gap-2 font-semibold">
            <KeyRound className="size-4 text-accent" />
            {t("account.recoverTitle")}
          </p>
        ) : (
          <Segmented
            label={t("account.title")}
            value={mode}
            onChange={switchMode}
            className="self-start"
            options={[
              { value: "login", label: t("account.login") },
              { value: "signup", label: t("account.signup") },
            ]}
          />
        )}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field
            label={t("account.username")}
            hint={mode === "signup" ? t("account.usernameRule") : undefined}
          >
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              maxLength={20}
              className={inputClass}
            />
          </Field>
          {mode === "recover" && (
            <Field
              label={t("account.recoveryCode")}
              hint={t("account.recoveryCodeHint")}
            >
              <input
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
                maxLength={40}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                className={inputClass + " font-mono uppercase"}
              />
            </Field>
          )}
          <Field
            label={
              mode === "recover"
                ? t("account.newPassword")
                : t("account.password")
            }
            hint={mode !== "login" ? t("account.passwordRule") : undefined}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              minLength={mode === "login" ? undefined : 8}
              className={inputClass}
            />
          </Field>
          {mode !== "login" && (
            <ConfirmField
              label={
                mode === "recover"
                  ? t("account.newPasswordConfirm")
                  : t("account.passwordConfirm")
              }
              value={confirm}
              password={password}
              onChange={setConfirm}
            />
          )}
          {mode === "signup" && (
            // 사람에게는 보이지 않는 칸: 자동 가입 봇만 채운다
            <input
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="absolute -left-[9999px] size-px opacity-0"
            />
          )}
          <ErrorLine error={signIn.error} />
          <Button
            type="submit"
            variant="primary"
            disabled={signIn.isPending}
            className="justify-center"
          >
            {t(submitLabel)}
          </Button>
          <button
            type="button"
            onClick={() => switchMode(mode === "recover" ? "login" : "recover")}
            className="self-center text-xs text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {mode === "recover"
              ? t("account.backToLogin")
              : t("account.forgot")}
          </button>
        </form>
      </Card>
      <Card className="flex flex-col gap-2 p-4 text-sm">
        <p className="flex items-start gap-2">
          <HardDrive className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>{t("account.guestNote")}</span>
        </p>
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" />
          <span className="text-muted">{t("account.privacyNote")}</span>
        </p>
      </Card>
    </>
  );
}

function SignedIn({
  username,
  onNewCode,
}: {
  username: string;
  onNewCode: (code: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const logoutAll = useLogoutAll();
  const [panel, setPanel] = useState<"password" | "code" | "delete" | null>(
    null,
  );

  return (
    <>
      <Card className="flex flex-col gap-4 p-5">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <UserRound className="size-5 text-accent" />
          {username}
        </p>
        <p className="text-sm text-muted">{t("account.memberNote")}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate("/players")}>
            {t("nav.players")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
          >
            <LogOut className="size-4" />
            {t("account.logout")}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col divide-y divide-border">
        <Section
          icon={<KeyRound className="size-4" />}
          title={t("account.changePassword")}
          open={panel === "password"}
          onToggle={() => setPanel(panel === "password" ? null : "password")}
        >
          <ChangePassword onDone={() => setPanel(null)} />
        </Section>
        <Section
          icon={<ShieldCheck className="size-4" />}
          title={t("account.newRecoveryCode")}
          open={panel === "code"}
          onToggle={() => setPanel(panel === "code" ? null : "code")}
        >
          <ConfirmPassword
            note={t("account.newRecoveryCodeNote")}
            submit={t("account.newRecoveryCodeSubmit")}
            run={(pw) =>
              api.newRecoveryCode(pw).then((r) => onNewCode(r.recovery_code))
            }
          />
        </Section>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2 text-sm">
            <MonitorSmartphone className="size-4 text-muted" />
            <span>
              {t("account.logoutAll")}
              <span className="block text-xs text-muted">
                {t("account.logoutAllNote")}
              </span>
            </span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={logoutAll.isPending}
            onClick={() =>
              logoutAll.mutate(undefined, {
                onSuccess: () => toast(t("account.loggedOutAll")),
              })
            }
          >
            {t("account.logoutAllSubmit")}
          </Button>
        </div>
        <Section
          icon={<Trash2 className="size-4 text-bad" />}
          title={t("account.delete")}
          danger
          open={panel === "delete"}
          onToggle={() => setPanel(panel === "delete" ? null : "delete")}
        >
          <DeleteAccount />
        </Section>
      </Card>
    </>
  );
}

function Section({
  icon,
  title,
  open,
  onToggle,
  danger,
  children,
}: {
  icon: ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={
          "flex items-center gap-2 px-4 py-3 text-left text-sm hover:bg-surface-2 " +
          (danger ? "text-bad" : "")
        }
      >
        {icon}
        {title}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (next !== confirm) return;
        setBusy(true);
        api
          .changePassword(current, next)
          .then(() => {
            toast.success(t("account.passwordChanged"));
            onDone();
          })
          .catch(setError)
          .finally(() => setBusy(false));
      }}
    >
      <Field label={t("account.currentPassword")}>
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </Field>
      <Field
        label={t("account.newPassword")}
        hint={t("account.passwordChangeNote")}
      >
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          className={inputClass}
        />
      </Field>
      <ConfirmField
        label={t("account.newPasswordConfirm")}
        value={confirm}
        password={next}
        onChange={setConfirm}
      />
      <ErrorLine error={error} />
      <Button
        type="submit"
        variant="primary"
        disabled={busy}
        className="self-start"
      >
        {t("account.changePasswordSubmit")}
      </Button>
    </form>
  );
}

function ConfirmPassword({
  note,
  submit,
  run,
}: {
  note: string;
  submit: string;
  run: (password: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        run(password)
          .catch(setError)
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-sm text-muted">{note}</p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        placeholder={t("account.password")}
        aria-label={t("account.password")}
        required
        className={inputClass}
      />
      <ErrorLine error={error} />
      <Button type="submit" disabled={busy} className="self-start">
        {submit}
      </Button>
    </form>
  );
}

function DeleteAccount() {
  const { t } = useTranslation();
  const del = useDeleteAccount();
  const [password, setPassword] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        del.mutate(password, { onSuccess: () => toast(t("account.deleted")) });
      }}
    >
      <p className="text-sm">{t("account.deleteConfirm")}</p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        placeholder={t("account.password")}
        aria-label={t("account.password")}
        required
        className={inputClass}
      />
      <ErrorLine error={del.error} />
      <Button
        type="submit"
        variant="danger"
        disabled={del.isPending}
        className="self-start"
      >
        {t("account.deleteFinal")}
      </Button>
    </form>
  );
}
