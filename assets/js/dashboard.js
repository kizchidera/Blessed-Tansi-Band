import { getCurrentSession, getProfile, signIn, signOut, signUp, watchAuthState } from "./auth.js";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const authPanel = $("#auth-panel");
const appPanel = $("#app-panel");
const pendingPanel = $("#pending-panel");
const viewContent = $("#view-content");
const viewError = $("#view-error");
const authError = $("#auth-error");
const authForm = $("#auth-form");
const toast = $("#toast");
const state = { session: null, profile: null, view: "overview", people: [], toastTimer: null };
const titleMap = {
  overview: ["YOUR BAND AT A GLANCE", "Good to see you."],
  directory: ["YOUR COMMUNITY", "Band directory"],
  finance: ["MEMBER FINANCIALS", "Financial hub"],
  updates: ["WHAT'S HAPPENING", "Updates & minutes"],
  "id-card": ["YOUR MEMBERSHIP", "Digital member ID"],
  users: ["LEADERSHIP TOOLS", "Member access"],
  payments: ["LEADERSHIP TOOLS", "Payment review"],
  content: ["LEADERSHIP TOOLS", "Publish an update"],
  import: ["LEADERSHIP TOOLS", "CSV tools"],
  settings: ["LEADERSHIP TOOLS", "Site settings"]
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function showMessage(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle("success", success);
}

function notify(message, error = false) {
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.dataset.originalLabel ||= button.textContent;
  button.textContent = busy ? label : button.dataset.originalLabel;
}

function applyTheme(theme) {
  const selected = theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = selected;
}

function initTheme() {
  const saved = localStorage.getItem("btb-theme") || "system";
  applyTheme(saved);
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("btb-theme", next);
    applyTheme(next);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem("btb-theme") || "system") === "system") applyTheme("system");
  });
}

function setAuthMode(mode) {
  const signupMode = mode === "signup";
  $("#name-field").classList.toggle("hidden", !signupMode);
  $("#name-field input").required = signupMode;
  $("#login-tab").classList.toggle("active", !signupMode);
  $("#signup-tab").classList.toggle("active", signupMode);
  $("#login-tab").setAttribute("aria-selected", String(!signupMode));
  $("#signup-tab").setAttribute("aria-selected", String(signupMode));
  $("#auth-title").textContent = signupMode ? "Join the band" : "Welcome back";
  $("#auth-description").textContent = signupMode
    ? "Create your account to request band membership."
    : "Sign in to your private member space.";
  $("#auth-submit").innerHTML = signupMode ? 'Request access <span>→</span>' : 'Sign in <span>→</span>';
  authForm.dataset.mode = mode;
  authForm.elements.password.autocomplete = signupMode ? "new-password" : "current-password";
  showMessage(authError, "");
}

function setScreen(screen) {
  authPanel.classList.toggle("hidden", screen !== "auth");
  pendingPanel.classList.toggle("hidden", screen !== "pending");
  appPanel.classList.toggle("hidden", screen !== "app");
  $("#sign-out").classList.toggle("hidden", screen === "auth");
}

function isAdmin() {
  return state.profile?.role === "superadmin" || state.profile?.role === "admin";
}

function can(permission) {
  return state.profile?.role === "superadmin" || state.profile?.[permission] === true;
}

async function loadHeroSettings() {
  if (!supabase) return;
  const { data, error } = await supabase.from("site_settings").select("key,value").in("key", ["hero_title", "hero_subtitle", "logo_path"]);
  if (error) {
    console.error("Could not load public site settings:", error.message);
    return;
  }
  for (const setting of data) {
    if (setting.key === "hero_title" && typeof setting.value === "string") {
      $("#hero-title").textContent = setting.value;
    }
    if (setting.key === "hero_subtitle" && typeof setting.value === "string") {
      $("#hero-subtitle").textContent = setting.value;
    }
    if (setting.key === "logo_path" && typeof setting.value === "string") {
      applyBrandLogo(setting.value);
    }
  }
}

function applyBrandLogo(path) {
  const container = $("#site-logo");
  container.replaceChildren();
  if (!path) {
    container.textContent = "BT";
    return;
  }
  const image = document.createElement("img");
  image.src = supabase.storage.from("site-branding").getPublicUrl(path).data.publicUrl;
  image.alt = "Blessed Tansi Band Group logo";
  container.append(image);
}

async function handleSession(session) {
  state.session = session;
  viewError.textContent = "";
  if (!session) {
    state.profile = null;
    setScreen("auth");
    return;
  }
  try {
    const profile = await getProfile(session.user.id);
    if (state.session?.user.id !== session.user.id) return;
    state.profile = profile;
    if (profile.status !== "approved") {
      $("#pending-title").textContent = "You're on the list.";
      $("#pending-message").textContent = "Your account is awaiting approval from the band leadership. Please check back after your membership is confirmed.";
      setScreen("pending");
      return;
    }
    setScreen("app");
    renderShell();
    await renderView(state.view);
  } catch (error) {
    console.error("Could not load the signed-in member profile:", error.message);
    $("#pending-title").textContent = "Profile unavailable";
    $("#pending-message").textContent = `We couldn't load your member profile: ${error.message}`;
    setScreen("pending");
  }
}

function renderShell() {
  const profile = state.profile;
  const initials = (profile.full_name || "BT").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  $("#member-name").textContent = profile.full_name || "Band member";
  $("#member-role").textContent = profile.role === "user" ? "Band member" : profile.role;
  $("#member-avatar").textContent = initials;
  $("#member-id-chip").textContent = profile.member_id;
  $("#admin-nav").classList.toggle("hidden", !isAdmin());
  $$(".superadmin-only").forEach((item) => item.classList.toggle("hidden", profile.role !== "superadmin"));
  $$("[data-view='payments']").forEach((item) => item.classList.toggle("hidden", !can("can_verify_payments") && !can("can_view_financials")));
  $$("[data-view='content']").forEach((item) => item.classList.toggle("hidden", !can("can_post_announcements") && !can("can_upload_minutes")));
  $$("[data-view='users'],[data-view='import']").forEach((item) => item.classList.toggle("hidden", profile.role !== "superadmin"));
}

function updateHeading(view) {
  const [eyebrow, title] = titleMap[view] || titleMap.overview;
  $("#page-eyebrow").textContent = eyebrow;
  $("#page-title").textContent = title;
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
}

function formatMoney(value) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function statusPill(status) {
  return `<span class="status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

async function queryRows(table, columns, configure = () => {}) {
  let query = supabase.from(table).select(columns);
  query = configure(query);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function overviewMarkup(payments, announcements, profile, total) {
  const latest = announcements.slice(0, 3);
  return `
    <div class="dashboard-grid">
      <article class="stat-card"><p>Verified contributions</p><strong>${formatMoney(total)}</strong><small>Updated as payments are verified</small></article>
      <article class="stat-card"><p>Membership</p><strong>${statusPill(profile.status)}</strong><small>Member since ${formatDate(profile.joined_at)}</small></article>
      <article class="stat-card"><p>Member ID</p><strong>${escapeHtml(profile.member_id)}</strong><small>Your unique band identity</small></article>
    </div>
    <section class="content-card"><div class="section-heading"><div><h2>Latest announcements</h2><p>News and notices from band leadership.</p></div><button class="button button-quiet button-small" data-go="updates" type="button">See all</button></div>
      <div class="data-list">${latest.length ? latest.map((item) => `<div class="list-row"><div><strong>${item.urgent ? "⚑ " : ""}${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body.slice(0, 130))}${item.body.length > 130 ? "…" : ""} · ${formatDate(item.created_at)}</small></div></div>`).join("") : emptyState("No announcements yet.")}</div>
    </section>
    <section class="content-card"><div class="section-heading"><div><h2>Recent contributions</h2><p>Your submitted payments and their review status.</p></div><button class="button button-quiet button-small" data-go="finance" type="button">Open finance</button></div>
      <div class="data-list">${payments.length ? payments.slice(0, 3).map((item) => `<div class="list-row"><div><strong>${formatMoney(item.amount)} · ${escapeHtml(item.description || "Contribution")}</strong><small>${formatDate(item.paid_at)}</small></div>${statusPill(item.status)}</div>`).join("") : emptyState("You haven't submitted any contributions yet.")}</div>
    </section>`;
}

async function renderOverview() {
  const financialRows = await queryRows("financial_summary", "user_id,total_verified", (query) =>
    can("can_view_financials") || can("can_verify_payments")
      ? query
      : query.eq("user_id", state.profile.id));
  const [payments, announcements, totals] = await Promise.all([
    queryRows("payments", "id,amount,description,status,paid_at", (query) => query.eq("user_id", state.profile.id).order("paid_at", { ascending: false }).limit(5)),
    queryRows("announcements", "id,title,body,urgent,created_at", (query) => query.order("created_at", { ascending: false }).limit(5)),
    Promise.resolve(financialRows)
  ]);
  const total = can("can_view_financials") || can("can_verify_payments")
    ? totals.reduce((sum, item) => sum + Number(item.total_verified || 0), 0)
    : totals.find((item) => item.user_id === state.profile.id)?.total_verified || 0;
  viewContent.innerHTML = overviewMarkup(payments, announcements, state.profile, total);
}

async function renderDirectory() {
  const profiles = await queryRows("profiles", "id,full_name,phone,avatar_path,member_id,role,joined_at", (query) => query.eq("status", "approved").order("full_name"));
  state.people = profiles;
  viewContent.innerHTML = `
    <section class="content-card">
      <div class="section-heading"><div><h2>Meet the band</h2><p>${profiles.length} approved members and executives.</p></div></div>
      <div class="toolbar"><input id="directory-search" class="control" type="search" placeholder="Search name or member ID" aria-label="Search directory"></div>
      <div id="directory-list">${directoryMarkup(profiles)}</div>
    </section>`;
  $("#directory-search").addEventListener("input", (event) => {
    const term = event.target.value.toLowerCase();
    const filtered = state.people.filter((person) =>
      `${person.full_name} ${person.member_id} ${person.role}`.toLowerCase().includes(term));
    $("#directory-list").innerHTML = directoryMarkup(filtered);
  });
}

function directoryMarkup(profiles) {
  if (!profiles.length) return emptyState("No members match that search.");
  return profiles.map((person) => {
    const initials = (person.full_name || "BT").split(/\s+/).slice(0, 2).map((name) => name[0]).join("").toUpperCase();
    const avatar = person.avatar_path
      ? `<div class="avatar" style="background-image:url('${escapeHtml(supabase.storage.from("member-avatars").getPublicUrl(person.avatar_path).data.publicUrl)}')" aria-label="${escapeHtml(person.full_name)}"></div>`
      : `<div class="avatar">${escapeHtml(initials)}</div>`;
    return `<article class="directory-card">${avatar}<div class="directory-card-main"><strong>${escapeHtml(person.full_name || "Band member")}</strong><small>${escapeHtml(person.member_id)} · ${escapeHtml(person.role === "user" ? "Member" : person.role)}${person.phone ? ` · ${escapeHtml(person.phone)}` : ""}</small></div></article>`;
  }).join("");
}

async function renderFinance() {
  const [payments, totals] = await Promise.all([
    queryRows("payments", "id,amount,description,status,paid_at,proof_path", (query) => query.eq("user_id", state.profile.id).order("paid_at", { ascending: false })),
    queryRows("financial_summary", "total_verified", (query) => query.eq("user_id", state.profile.id))
  ]);
  const rows = payments.length ? payments.map((payment) => `
    <div class="list-row"><div><strong>${formatMoney(payment.amount)} · ${escapeHtml(payment.description || "Contribution")}</strong><small>${formatDate(payment.paid_at)}${payment.proof_path ? ` · <a href="#" data-proof="${escapeHtml(payment.proof_path)}">View proof</a>` : ""}</small></div>${statusPill(payment.status)}</div>`).join("") : emptyState("No contributions have been submitted.");
  viewContent.innerHTML = `
    <div class="dashboard-grid"><article class="stat-card"><p>Your verified total</p><strong>${formatMoney(totals[0]?.total_verified || 0)}</strong><small>Only confirmed contributions are included.</small></article><article class="stat-card"><p>Submissions</p><strong>${payments.length}</strong><small>All-time payment records</small></article></div>
    <section class="content-card"><div class="section-heading"><div><h2>Submit a contribution</h2><p>Upload an image or PDF receipt for treasurer review.</p></div></div>
      <form id="payment-form" class="form-grid">
        <label class="field">Amount<input name="amount" type="number" min="0.01" step="0.01" required></label>
        <label class="field">Contribution type<input name="description" maxlength="120" placeholder="e.g. Monthly dues" required></label>
        <label class="field span-all">Payment receipt<input class="file-input" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>
        <div class="span-all"><p id="payment-message" class="form-message"></p><button class="button button-primary" type="submit">Submit for verification</button></div>
      </form>
    </section>
    <section class="content-card"><div class="section-heading"><div><h2>Your payment history</h2><p>Confirmation updates your verified total automatically.</p></div></div><div id="my-payment-list" class="data-list">${rows}</div></section>`;
  $("#payment-form").addEventListener("submit", submitPayment);
  $$("[data-proof]").forEach((link) => link.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      const { data, error } = await supabase.storage.from("payment-receipts").createSignedUrl(event.currentTarget.dataset.proof, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener");
    } catch (error) { notify(`Unable to open receipt: ${error.message}`, true); }
  }));
}

async function submitPayment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type='submit']", form);
  const message = $("#payment-message");
  const file = form.elements.proof.files[0];
  if (!file) return;
  setBusy(button, true, "Uploading…");
  try {
    const path = `${state.profile.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage.from("payment-receipts").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await supabase.from("payments").insert({
      user_id: state.profile.id,
      amount: Number(form.elements.amount.value),
      description: form.elements.description.value.trim(),
      proof_path: path
    });
    if (error) {
      const { error: cleanupError } = await supabase.storage.from("payment-receipts").remove([path]);
      if (cleanupError) console.error("Receipt cleanup failed after payment insert error:", cleanupError.message);
      throw error;
    }
    form.reset();
    showMessage(message, "Contribution submitted for review.", true);
    notify("Payment submitted for review.");
    await renderFinance();
  } catch (error) {
    showMessage(message, `Payment could not be submitted: ${error.message}`);
    setBusy(button, false);
  }
}

async function renderUpdates() {
  const [announcements, minutes] = await Promise.all([
    queryRows("announcements", "id,title,body,urgent,created_at", (query) => query.order("created_at", { ascending: false })),
    queryRows("minutes", "id,title,meeting_date,file_path,created_at", (query) => query.order("meeting_date", { ascending: false }))
  ]);
  viewContent.innerHTML = `
    <section class="content-card"><div class="section-heading"><div><h2>Announcements</h2><p>Notices from your band leadership.</p></div></div>
      <div class="data-list">${announcements.length ? announcements.map((item) => `<article class="list-row"><div><strong>${item.urgent ? "⚑ " : ""}${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body)} · ${formatDate(item.created_at)}</small></div>${item.urgent ? '<span class="status-pill rejected">Urgent</span>' : ""}</article>`).join("") : emptyState("No announcements yet.")}</div>
    </section>
    <section class="content-card"><div class="section-heading"><div><h2>Meeting minutes</h2><p>Official meeting records shared with members.</p></div></div>
      <div class="data-list">${minutes.length ? minutes.map((item) => `<div class="list-row"><div><strong>${escapeHtml(item.title)}</strong><small>${formatDate(item.meeting_date)}</small></div><button class="button button-quiet button-small" data-minute="${escapeHtml(item.file_path)}" type="button">Open PDF</button></div>`).join("") : emptyState("Meeting minutes will appear here.")}</div>
    </section>`;
  $$("[data-minute]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const { data, error } = await supabase.storage.from("meeting-minutes").createSignedUrl(button.dataset.minute, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener");
    } catch (error) { notify(`Unable to open meeting minutes: ${error.message}`, true); }
  }));
}

async function renderIdCard() {
  const profile = state.profile;
  const initials = (profile.full_name || "BT").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const photoUrl = profile.avatar_path
    ? supabase.storage.from("member-avatars").getPublicUrl(profile.avatar_path).data.publicUrl
    : "";
  viewContent.innerHTML = `
    <section class="content-card"><div class="section-heading"><div><h2>Your digital membership card</h2><p>Print or save a copy for your records.</p></div></div>
      <article id="printable-id" class="id-card"><div class="id-card-top"><div class="id-card-brand">BLESSED TANSI<small>BAND GROUP · MEMBER ID</small></div><span>${statusPill(profile.status)}</span></div>
        <div class="id-card-content">${photoUrl ? `<img class="id-card-photo" src="${escapeHtml(photoUrl)}" alt="Member portrait">` : ""}<div class="id-card-info"><p class="id-card-name">${escapeHtml(profile.full_name || "Band member")}</p><p class="id-card-meta">MEMBER SINCE ${escapeHtml(formatDate(profile.joined_at).toUpperCase())}<br>${escapeHtml(profile.role === "user" ? "BAND MEMBER" : profile.role.toUpperCase())}</p></div><canvas class="qr-code" id="member-qr" aria-label="QR code for your membership ID"></canvas></div>
        <div class="id-card-bottom"><span class="id-card-number">${escapeHtml(profile.member_id)}</span><span>${escapeHtml(initials)}</span></div>
      </article>
      <div class="id-actions" style="margin-top:16px;display:flex;gap:9px;align-items:end;flex-wrap:wrap">
        <button id="print-id" class="button button-primary" type="button">Print / Save PDF</button>
        <label class="field" style="margin:0">Update profile photo<input id="avatar-file" type="file" class="file-input" accept="image/jpeg,image/png,image/webp"></label>
      </div>
    </section>`;
  const QRCode = await import("https://esm.sh/qrcode@1.5.3?bundle");
  await QRCode.toCanvas($("#member-qr"), `${location.origin}${location.pathname}#member=${encodeURIComponent(profile.member_id)}`, {
    width: 160, margin: 0, color: { dark: "#171923", light: "#ffffff" }
  });
  $("#print-id").addEventListener("click", () => window.print());
  $("#avatar-file").addEventListener("change", uploadAvatar);
}

async function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const path = `${state.profile.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage.from("member-avatars").upload(path, file, {
      contentType: file.type,
      upsert: false
    });
    if (uploadError) throw uploadError;
    const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", state.profile.id);
    if (error) {
      const { error: cleanupError } = await supabase.storage.from("member-avatars").remove([path]);
      if (cleanupError) console.error("Avatar cleanup failed after profile update error:", cleanupError.message);
      throw error;
    }
    state.profile.avatar_path = path;
    notify("Profile photo updated.");
    await renderIdCard();
  } catch (error) {
    notify(`Could not update profile photo: ${error.message}`, true);
  }
}

async function renderUsers() {
  if (state.profile.role !== "superadmin") throw new Error("Only superadmins can manage member access.");
  const profiles = await queryRows("profiles", "id,full_name,member_id,role,status,can_upload_minutes,can_verify_payments,can_view_financials,can_post_announcements,joined_at", (query) => query.order("joined_at", { ascending: false }));
  viewContent.innerHTML = `
    <section class="content-card"><div class="section-heading"><div><h2>Member accounts</h2><p>Approve memberships and configure executive access.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Member</th><th>Status</th><th>Role</th><th>Executive permissions</th><th>Save</th></tr></thead><tbody>
      ${profiles.map((person) => `<tr data-user-row="${escapeHtml(person.id)}">
        <td><strong>${escapeHtml(person.full_name || "New member")}</strong><div class="helper-text">${escapeHtml(person.member_id)}</div></td>
        <td><select class="control user-status" aria-label="Membership status">${["pending", "approved", "suspended"].map((item) => `<option value="${item}" ${person.status === item ? "selected" : ""}>${item}</option>`).join("")}</select></td>
        <td><select class="control user-role" aria-label="Member role">${["user", "admin", "superadmin"].map((item) => `<option value="${item}" ${person.role === item ? "selected" : ""}>${item}</option>`).join("")}</select></td>
        <td><div class="check-grid">
          <label><input type="checkbox" data-permission="can_upload_minutes" ${person.can_upload_minutes ? "checked" : ""}> Minutes</label>
          <label><input type="checkbox" data-permission="can_verify_payments" ${person.can_verify_payments ? "checked" : ""}> Payments</label>
          <label><input type="checkbox" data-permission="can_view_financials" ${person.can_view_financials ? "checked" : ""}> Financial report</label>
          <label><input type="checkbox" data-permission="can_post_announcements" ${person.can_post_announcements ? "checked" : ""}> Announcements</label>
        </div></td>
        <td><button class="button button-primary button-small save-user" type="button">Save</button></td>
      </tr>`).join("")}
      </tbody></table></div>
    </section>`;
  $$(".save-user").forEach((button) => button.addEventListener("click", async () => {
    const row = button.closest("[data-user-row]");
    const id = row.dataset.userRow;
    const updates = {
      status: $(".user-status", row).value,
      role: $(".user-role", row).value,
      can_upload_minutes: $("[data-permission='can_upload_minutes']", row).checked,
      can_verify_payments: $("[data-permission='can_verify_payments']", row).checked,
      can_view_financials: $("[data-permission='can_view_financials']", row).checked,
      can_post_announcements: $("[data-permission='can_post_announcements']", row).checked
    };
    if (id === state.profile.id && updates.role !== "superadmin") {
      notify("You cannot remove your own superadmin role.", true);
      return;
    }
    setBusy(button, true, "Saving…");
    try {
      const { error } = await supabase.from("profiles").update(updates).eq("id", id);
      if (error) throw error;
      notify("Member access updated.");
      await renderUsers();
    } catch (error) {
      notify(`Could not update member: ${error.message}`, true);
      setBusy(button, false);
    }
  }));
}

async function renderPayments() {
  if (!can("can_verify_payments") && !can("can_view_financials")) {
    throw new Error("Your account does not have financial reporting permission.");
  }
  const payments = await queryRows("payments", "id,user_id,amount,description,status,paid_at,proof_path,member:profiles!payments_user_id_fkey(full_name,member_id)", (query) => query.order("paid_at", { ascending: false }));
  const verifiedTotal = payments.filter((payment) => payment.status === "verified")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const rows = payments.length ? payments.map((payment) => {
    const member = Array.isArray(payment.member) ? payment.member[0] : payment.member;
    const actions = can("can_verify_payments") && payment.status === "pending" ? `<button class="button button-primary button-small review-payment" data-status="verified" data-id="${escapeHtml(payment.id)}" type="button">Verify</button> <button class="button button-danger button-small review-payment" data-status="rejected" data-id="${escapeHtml(payment.id)}" type="button">Reject</button>` : "—";
    const proof = payment.proof_path && can("can_verify_payments") ? `<button class="button button-quiet button-small open-receipt" data-path="${escapeHtml(payment.proof_path)}" type="button">Receipt</button>` : "—";
    return `<tr><td><strong>${escapeHtml(member?.full_name || "Member")}</strong><div class="helper-text">${escapeHtml(member?.member_id || "")}</div></td><td>${formatMoney(payment.amount)}</td><td>${escapeHtml(payment.description || "Contribution")}<div class="helper-text">${formatDate(payment.paid_at)}</div></td><td>${statusPill(payment.status)}</td><td>${proof}</td><td>${actions}</td></tr>`;
  }).join("") : '<tr><td colspan="6">No payment submissions yet.</td></tr>';
  viewContent.innerHTML = `<div class="dashboard-grid"><article class="stat-card"><p>Total verified contributions</p><strong>${formatMoney(verifiedTotal)}</strong><small>Automatically reflects verified payments</small></article><article class="stat-card"><p>Recorded contributions</p><strong>${payments.length}</strong><small>Includes pending and rejected submissions</small></article></div>
    <section class="content-card"><div class="section-heading"><div><h2>${can("can_verify_payments") ? "Contribution verification" : "Financial report"}</h2><p>${can("can_verify_payments") ? "Confirm receipts to synchronize member and reporting totals." : "Verified member contributions across the band."}</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Member</th><th>Amount</th><th>Contribution</th><th>Status</th><th>Proof</th><th>Review</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  $$(".review-payment").forEach((button) => button.addEventListener("click", async () => {
    setBusy(button, true, "Saving…");
    const updates = { status: button.dataset.status, verified_by: state.profile.id, verified_at: new Date().toISOString() };
    try {
      const { error } = await supabase.from("payments").update(updates).eq("id", button.dataset.id);
      if (error) throw error;
      notify(button.dataset.status === "verified" ? "Payment verified. Member totals are updated." : "Payment marked as rejected.");
      await renderPayments();
    } catch (error) {
      notify(`Could not update payment: ${error.message}`, true);
      setBusy(button, false);
    }
  }));
  $$(".open-receipt").forEach((button) => button.addEventListener("click", async () => {
    try {
      const { data, error } = await supabase.storage.from("payment-receipts").createSignedUrl(button.dataset.path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener");
    } catch (error) { notify(`Unable to open receipt: ${error.message}`, true); }
  }));
}

async function renderContent() {
  if (!can("can_post_announcements") && !can("can_upload_minutes")) {
    throw new Error("Your account does not have publishing permission.");
  }
  const showAnnouncements = can("can_post_announcements");
  const showMinutes = can("can_upload_minutes");
  viewContent.innerHTML = `
    ${showAnnouncements ? `<section class="content-card"><div class="section-heading"><div><h2>New announcement</h2><p>Share an update with approved band members.</p></div></div>
      <form id="announcement-form" class="form-grid"><label class="field span-all">Headline<input name="title" maxlength="120" required></label><label class="field span-all">Message<textarea name="body" maxlength="4000" required></textarea></label><div class="span-all check-grid"><label><input name="urgent" type="checkbox"> Mark as urgent</label></div><div class="span-all"><button class="button button-primary" type="submit">Publish announcement</button></div></form>
    </section>` : ""}
    ${showMinutes ? `<section class="content-card"><div class="section-heading"><div><h2>Upload meeting minutes</h2><p>PDF only. Members will be able to view the minutes after upload.</p></div></div>
      <form id="minutes-form" class="form-grid"><label class="field">Meeting title<input name="title" maxlength="160" required></label><label class="field">Meeting date<input name="meeting_date" type="date" required></label><label class="field span-all">Minutes PDF<input name="file" type="file" class="file-input" accept="application/pdf" required></label><div class="span-all"><button class="button button-primary" type="submit">Upload minutes</button></div></form>
    </section>` : ""}`;
  if (showAnnouncements) $("#announcement-form").addEventListener("submit", publishAnnouncement);
  if (showMinutes) $("#minutes-form").addEventListener("submit", uploadMinutes);
}

async function publishAnnouncement(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type='submit']", form);
  setBusy(button, true, "Publishing…");
  try {
    const { error } = await supabase.from("announcements").insert({
      title: form.elements.title.value.trim(),
      body: form.elements.body.value.trim(),
      urgent: form.elements.urgent.checked,
      posted_by: state.profile.id
    });
    if (error) throw error;
    form.reset();
    notify("Announcement published.");
    setBusy(button, false);
  } catch (error) {
    notify(`Could not publish announcement: ${error.message}`, true);
    setBusy(button, false);
  }
}

async function uploadMinutes(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type='submit']", form);
  const file = form.elements.file.files[0];
  if (!file) return;
  setBusy(button, true, "Uploading…");
  try {
    const path = `${state.profile.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage.from("meeting-minutes").upload(path, file, { contentType: "application/pdf" });
    if (uploadError) throw uploadError;
    const { error } = await supabase.from("minutes").insert({
      title: form.elements.title.value.trim(),
      meeting_date: form.elements.meeting_date.value,
      file_path: path,
      uploaded_by: state.profile.id
    });
    if (error) {
      const { error: cleanupError } = await supabase.storage.from("meeting-minutes").remove([path]);
      if (cleanupError) console.error("Minutes cleanup failed after record insert error:", cleanupError.message);
      throw error;
    }
    form.reset();
    notify("Meeting minutes uploaded.");
    setBusy(button, false);
  } catch (error) {
    notify(`Could not upload minutes: ${error.message}`, true);
    setBusy(button, false);
  }
}

function renderImport() {
  if (state.profile.role !== "superadmin") throw new Error("Only superadmins can import records.");
  viewContent.innerHTML = `
    <section class="content-card"><div class="section-heading"><div><h2>Import member updates</h2><p>Updates existing accounts only; members must sign up first. Use the user's auth UUID from Supabase.</p></div></div>
      <p><a href="assets/templates/member_import_template.csv" download>Download member template</a></p>
      <label class="field">Member CSV<input id="member-csv" class="file-input" type="file" accept=".csv,text/csv"></label><div id="member-preview"></div>
    </section>
    <section class="content-card"><div class="section-heading"><div><h2>Import historical contributions</h2><p>Imported records are marked verified and attributed to you as the importing superadmin.</p></div></div>
      <p><a href="assets/templates/payment_history_import_template.csv" download>Download contribution history template</a></p>
      <label class="field">Financial history CSV<input id="payment-csv" class="file-input" type="file" accept=".csv,text/csv"></label><div id="payment-preview"></div>
    </section>`;
  $("#member-csv").addEventListener("change", (event) => parseCsv(event, "member"));
  $("#payment-csv").addEventListener("change", (event) => parseCsv(event, "payment"));
}

function validateCsvRows(rows, type) {
  const required = type === "member"
    ? ["id", "full_name", "phone", "status"]
    : ["user_id", "amount", "description", "paid_at"];
  const issues = [];
  const validated = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const missing = required.filter((column) => !(column in row));
    if (missing.length) {
      issues.push(`Line ${line}: missing column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}.`);
      return;
    }
    if (type === "member") {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id || "")) {
        issues.push(`Line ${line}: id must be a valid Supabase user UUID.`);
      } else if (!row.full_name?.trim() || !["pending", "approved", "suspended"].includes(row.status)) {
        issues.push(`Line ${line}: full_name is required and status must be pending, approved, or suspended.`);
      } else {
        validated.push({ id: row.id, full_name: row.full_name.trim(), phone: row.phone?.trim() || null, status: row.status });
      }
    } else {
      const amount = Number(row.amount);
      const paidAt = new Date(row.paid_at);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.user_id || "")) {
        issues.push(`Line ${line}: user_id must be a valid Supabase user UUID.`);
      } else if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(paidAt.getTime())) {
        issues.push(`Line ${line}: amount must be positive and paid_at must be a valid date/time.`);
      } else {
        validated.push({ user_id: row.user_id, amount, description: row.description?.trim() || "", paid_at: paidAt.toISOString() });
      }
    }
  });
  return { validated, issues };
}

function parseCsv(event, type) {
  const file = event.target.files[0];
  const output = $(`#${type === "member" ? "member" : "payment"}-preview`);
  if (!file) return;
  if (!window.Papa) {
    output.innerHTML = '<p class="form-message">CSV parser failed to load. Check the network connection and refresh.</p>';
    return;
  }
  window.Papa.parse(file, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
    complete: ({ data, errors, meta }) => {
      const result = validateCsvRows(data, type);
      if (errors.length || meta.fields?.some((field) => !field)) {
        output.innerHTML = `<p class="form-message">CSV parsing error: ${escapeHtml(errors[0]?.message || "A column header is blank.")}</p>`;
        return;
      }
      const previewRows = result.validated.slice(0, 5);
      const columns = type === "member" ? ["id", "full_name", "phone", "status"] : ["user_id", "amount", "description", "paid_at"];
      output.innerHTML = `
        <p class="helper-text">${result.validated.length} valid row(s); ${result.issues.length} issue(s).</p>
        ${result.issues.length ? `<div class="preview-box">${result.issues.slice(0, 8).map(escapeHtml).join("<br>")}${result.issues.length > 8 ? "<br>More errors omitted." : ""}</div>` : ""}
        ${previewRows.length ? `<div class="preview-box"><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${previewRows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
        <button class="button button-primary import-confirm" type="button" ${!result.validated.length || result.issues.length ? "disabled" : ""}>Import ${result.validated.length} valid row(s)</button>`;
      const button = $(".import-confirm", output);
      if (button && result.validated.length && !result.issues.length) {
        button.addEventListener("click", () => importRows(result.validated, type, button));
      }
    },
    error: (error) => { output.innerHTML = `<p class="form-message">Could not read CSV: ${escapeHtml(error.message)}</p>`; }
  });
}

async function importRows(rows, type, button) {
  if (!window.confirm(`Import ${rows.length} ${type === "member" ? "member" : "historical payment"} row(s)?`)) return;
  setBusy(button, true, "Importing…");
  let imported = 0;
  try {
    for (const row of rows) {
      const result = type === "member"
        ? await supabase.from("profiles").update({
            full_name: row.full_name, phone: row.phone, status: row.status
          }).eq("id", row.id)
        : await supabase.rpc("import_historical_payment", {
            p_user_id: row.user_id,
            p_amount: row.amount,
            p_description: row.description,
            p_paid_at: row.paid_at
          });
      if (result.error) throw new Error(`Stopped after ${imported} row(s): ${result.error.message}`);
      imported += 1;
    }
    notify(`${imported} row(s) imported successfully.`);
    setBusy(button, false);
    button.textContent = "Import complete";
  } catch (error) {
    notify(`Import incomplete after ${imported} row(s): ${error.message}`, true);
    setBusy(button, false);
  }
}

async function renderSettings() {
  if (state.profile.role !== "superadmin") throw new Error("Only superadmins can edit site branding.");
  const settings = await queryRows("site_settings", "key,value", (query) => query.in("key", ["hero_title", "hero_subtitle", "logo_path"]));
  const values = Object.fromEntries(settings.map((item) => [item.key, item.value]));
  viewContent.innerHTML = `
    <section class="content-card"><div class="section-heading"><div><h2>Landing page content</h2><p>Update the public welcome message without changing source code.</p></div></div>
      <form id="settings-form"><label class="field">Hero title<input name="hero_title" maxlength="100" required value="${escapeHtml(values.hero_title || "Blessed Tansi Band Group")}"></label>
        <label class="field">Hero subtitle<textarea name="hero_subtitle" maxlength="240" required>${escapeHtml(values.hero_subtitle || "Together in music, service, and community.")}</textarea></label>
        <label class="field">Site logo (PNG, JPG, or WebP)<input name="logo" type="file" class="file-input" accept="image/jpeg,image/png,image/webp"></label>
        <button class="button button-primary" type="submit">Save landing page</button></form>
    </section>`;
  $("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button[type='submit']", form);
    setBusy(button, true, "Saving…");
    let uploadedLogoPath = "";
    try {
      const logoFile = form.elements.logo.files[0];
      if (logoFile) {
        uploadedLogoPath = `${state.profile.id}/${crypto.randomUUID()}-${logoFile.name.replace(/[^\w.-]/g, "_")}`;
        const { error: uploadError } = await supabase.storage.from("site-branding").upload(uploadedLogoPath, logoFile, {
          contentType: logoFile.type,
          upsert: false
        });
        if (uploadError) throw uploadError;
      }
      const settings = [
        { key: "hero_title", value: form.elements.hero_title.value.trim(), updated_by: state.profile.id, updated_at: new Date().toISOString() },
        { key: "hero_subtitle", value: form.elements.hero_subtitle.value.trim(), updated_by: state.profile.id, updated_at: new Date().toISOString() },
        ...(uploadedLogoPath ? [{ key: "logo_path", value: uploadedLogoPath, updated_by: state.profile.id, updated_at: new Date().toISOString() }] : [])
      ];
      const { error } = await supabase.from("site_settings").upsert(settings);
      if (error) throw error;
      $("#hero-title").textContent = settings[0].value;
      $("#hero-subtitle").textContent = settings[1].value;
      if (uploadedLogoPath) applyBrandLogo(uploadedLogoPath);
      notify("Landing page content saved.");
      setBusy(button, false);
    } catch (error) {
      if (uploadedLogoPath) {
        const { error: cleanupError } = await supabase.storage.from("site-branding").remove([uploadedLogoPath]);
        if (cleanupError) console.error("Logo cleanup failed after settings save error:", cleanupError.message);
      }
      notify(`Could not save site settings: ${error.message}`, true);
      setBusy(button, false);
    }
  });
}

async function renderView(view) {
  state.view = view;
  updateHeading(view);
  viewError.textContent = "";
  viewContent.innerHTML = '<div class="empty-state">Loading your band space…</div>';
  try {
    switch (view) {
      case "overview": await renderOverview(); break;
      case "directory": await renderDirectory(); break;
      case "finance": await renderFinance(); break;
      case "updates": await renderUpdates(); break;
      case "id-card": await renderIdCard(); break;
      case "users": await renderUsers(); break;
      case "payments": await renderPayments(); break;
      case "content": await renderContent(); break;
      case "import": renderImport(); break;
      case "settings": await renderSettings(); break;
      default: throw new Error("That page is not available.");
    }
  } catch (error) {
    console.error(`Could not render ${view}:`, error.message);
    viewContent.innerHTML = "";
    showMessage(viewError, `This section could not be loaded: ${error.message}`);
  }
  $$("[data-go]").forEach((button) => button.addEventListener("click", () => renderView(button.dataset.go)));
}

function initNavigation() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => renderView(button.dataset.view)));
}

function initAuthForm() {
  $("#login-tab").addEventListener("click", () => setAuthMode("login"));
  $("#signup-tab").addEventListener("click", () => setAuthMode("signup"));
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#auth-submit");
    setBusy(button, true, "Please wait…");
    showMessage(authError, "");
    try {
      const email = authForm.elements.email.value.trim();
      const password = authForm.elements.password.value;
      if (authForm.dataset.mode === "signup") {
        const result = await signUp(email, password, authForm.elements.full_name.value.trim());
        if (result.session) {
          showMessage(authError, "Your account was created and is awaiting band approval.", true);
        } else {
          showMessage(authError, "Check your email to confirm your account. Your membership will then await band approval.", true);
        }
        authForm.reset();
      } else {
        await signIn(email, password);
      }
    } catch (error) {
      showMessage(authError, error.message);
    } finally {
      setBusy(button, false);
      const signupMode = authForm.dataset.mode === "signup";
      button.innerHTML = signupMode ? 'Request access <span>→</span>' : 'Sign in <span>→</span>';
    }
  });
}

async function init() {
  initTheme();
  initAuthForm();
  initNavigation();
  $("#sign-out").addEventListener("click", async () => {
    try { await signOut(); }
    catch (error) { notify(`Sign out failed: ${error.message}`, true); }
  });
  $$(".sign-out-action").forEach((button) => button.addEventListener("click", async () => {
    try { await signOut(); }
    catch (error) { notify(`Sign out failed: ${error.message}`, true); }
  }));
  if (!isSupabaseConfigured) {
    $("#connection-status").textContent = "Supabase setup needed";
    showMessage(authError, "Configure the Supabase URL and publishable key in assets/js/supabaseClient.js to enable accounts.");
    return;
  }
  $("#connection-status").innerHTML = "<span></span> Supabase configured";
  await loadHeroSettings();
  watchAuthState((session) => {
    handleSession(session).catch((error) => {
      console.error("Authentication state could not be loaded:", error.message);
      showMessage(viewError, error.message);
    });
  });
  try {
    await handleSession(await getCurrentSession());
  } catch (error) {
    console.error("Could not restore the current session:", error.message);
    showMessage(authError, `Could not restore your sign-in: ${error.message}`);
  }
}

init();
