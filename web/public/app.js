/* global BroadcastChannel, addEventListener, document, fetch, FormData, location, setTimeout */
const messages = {
  CODE_REJECTED: "인증번호를 확인해 주세요. 만료되었다면 다시 받아 주세요.",
  CONSENT_REQUIRED: "이용약관 및 개인정보 처리방침 동의가 필요합니다.",
  INVALID_EMAIL: "이메일 주소를 확인해 주세요.",
  SIGN_OUT_FIRST: "이미 로그인되어 있습니다. 공간 목록을 열어 주세요.",
  DEVICE_LIMIT: "등록 가능한 기기 수에 도달했습니다. 운영자에게 문의해 주세요.",
  DEVICE_REVOKED: "이 브라우저의 이용 권한이 회수되었습니다. 운영자에게 문의해 주세요.",
  TRY_LATER: "요청이 많습니다. 잠시 뒤 다시 시도해 주세요.",
};
const fallback = "연결을 확인한 뒤 다시 시도해 주세요.";

async function api(path, payload) {
  const options = payload
    ? {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    : {};
  const response = await fetch(path, options);
  const data = await response.json();
  if (response.ok) return data;
  const error = new Error(messages[data.error] ?? fallback);
  error.status = response.status;
  error.code = data.error;
  throw error;
}

const emailForm = document.querySelector("#email-form");
if (emailForm) {
  const codeForm = document.querySelector("#code-form");
  const emailInput = document.querySelector("#email");
  const codeInput = document.querySelector("#code");
  const resend = document.querySelector("#resend-code");
  const status = document.querySelector("#login-status");
  const description = document.querySelector("#login-description");
  const startDescription = description.textContent;
  let resendAfter = 0;

  async function sendCode() {
    const fields = new FormData(emailForm);
    await api("/api/auth/code", {
      email: fields.get("email"),
      agreed: fields.has("agree"),
      version: emailForm.dataset.version,
    });
    emailForm.hidden = true;
    codeForm.hidden = false;
    description.textContent = "등록된 이메일이라면 인증번호가 도착합니다. 메일함을 확인해 주세요.";
    codeInput.value = "";
    codeInput.focus();
    resendAfter = Date.now() + 60000;
    resend.disabled = true;
    setTimeout(() => {
      if (Date.now() >= resendAfter && codeForm.getAttribute("aria-busy") !== "true") resend.disabled = false;
    }, 60100);
  }

  function bind(control, type, form, action, pending) {
    control.addEventListener(type, async (event) => {
      event.preventDefault();
      if (form.getAttribute("aria-busy") === "true") return;
      form.setAttribute("aria-busy", "true");
      form.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
      status.textContent = pending;
      try {
        await action();
        status.textContent = "";
      } catch (error) {
        if (error.code === "SIGN_OUT_FIRST") return location.assign("/spaces");
        status.textContent = error.status ? error.message : fallback;
      } finally {
        form.removeAttribute("aria-busy");
        form.querySelectorAll("button").forEach((button) => {
          button.disabled = false;
        });
        resend.disabled = Date.now() < resendAfter;
      }
    });
  }

  bind(emailForm, "submit", emailForm, sendCode, "인증번호 요청 중입니다.");
  bind(resend, "click", codeForm, sendCode, "인증번호 요청 중입니다.");
  bind(
    codeForm,
    "submit",
    codeForm,
    async () => {
      await api("/api/auth/verify", { code: codeInput.value });
      location.assign("/spaces");
    },
    "인증번호 확인 중입니다.",
  );

  document.querySelector("#change-email").addEventListener("click", () => {
    if (codeForm.getAttribute("aria-busy") === "true") return;
    codeForm.hidden = true;
    emailForm.hidden = false;
    description.textContent = startDescription;
    status.textContent = "";
    emailInput.focus();
  });
}

const list = document.querySelector("#space-list");
if (list) {
  const status = document.querySelector("#space-status");
  const reload = document.querySelector("#reload-spaces");
  const logout = document.querySelector("#logout");
  const empty = document.querySelector("#empty-spaces");
  const sessionEvents =
    typeof BroadcastChannel === "function" ? new BroadcastChannel("wj-web-session") : null;
  let requestNumber = 0;
  const account = document.querySelector("#account-email");
  function clearSpaces() {
    list.replaceChildren();
    account.textContent = "";
    empty.hidden = true;
  }
  function returnToLogin() {
    requestNumber++;
    clearSpaces();
    location.replace("/login");
  }
  async function loadSpaces() {
    const current = ++requestNumber;
    reload.hidden = true;
    reload.disabled = true;
    status.textContent = "공간을 불러오는 중입니다.";
    try {
      const { email, spaces } = await api("/api/spaces");
      if (current !== requestNumber) return;
      account.textContent = email;
      const items = spaces.map(({ name, color }) => {
        const item = document.createElement("li");
        const title = document.createElement("span");
        title.textContent = name;
        item.dataset.color = color;
        item.append(title);
        return item;
      });
      list.replaceChildren(...items);
      empty.hidden = spaces.length > 0;
      status.textContent = "";
    } catch (error) {
      if (current !== requestNumber) return;
      if (error.status === 401 || error.status === 403) return returnToLogin();
      clearSpaces();
      status.textContent = error.status ? error.message : fallback;
      reload.hidden = false;
    } finally {
      reload.disabled = false;
    }
  }
  reload.addEventListener("click", loadSpaces);
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    requestNumber++;
    try {
      await api("/api/auth/logout", {});
      sessionEvents?.postMessage("logout");
      returnToLogin();
    } catch (error) {
      status.textContent = error.status ? error.message : fallback;
      reload.hidden = false;
    } finally {
      logout.disabled = false;
    }
  });
  sessionEvents?.addEventListener("message", (event) => {
    if (event.data === "logout") returnToLogin();
  });
  addEventListener("pagehide", () => {
    requestNumber++;
    clearSpaces();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted && !logout.disabled) loadSpaces();
  });
  loadSpaces();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !logout.disabled) loadSpaces();
  });
}
