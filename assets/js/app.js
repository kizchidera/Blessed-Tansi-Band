(() => {
  "use strict";


  const CONFIG = {
    googleClientId: "302392212120-ahsmq6b22a74h5538u4etkh8c3c5mpte.apps.googleusercontent.com",
    publishedCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSyX3EAbrlffUM16wNh3PeHzhmU0zzt2RP3YpvKC1QXdcbN_CShBWtYR0evVGjyBDXqMx7ifGtGBgtS/pub?gid=0&single=true&output=csv",
    appsScriptUrl: "https://script.google.com/macros/s/AKfycbyhgRzTQj2A9PXqGRsyIBUitoZiEt8F5kcFQx1Lc_FsOokrbhEno3vWE3uW9WCp4eoePA/exec"
  };
  const state = {
    credential: "",
    profile: null,
    role: "",
    publicData: { members: [], announcements: [], minutes: [] },
    importRows: null
  };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const text = (value, fallback = "") => String(value == null || value === "" ? fallback : value);


  document.addEventListener("DOMContentLoaded", init);


  async function init() {
    initTheme();
    bindEvents();
    await loadPublicData();
    initGoogleSignIn();
    const savedCredential = sessionStorage.getItem("btb_google_credential");
    if (savedCredential) {
      state.credential = savedCredential;
      await loadMemberProfile();
    }
  }

(() => {
  "use strict";

  const CONFIG = {
    googleClientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID",
    publishedCsvUrl: "https://docs.google.com/spreadsheets/d/e/YOUR_PUBLISHED_SHEET_ID/pub?output=csv",
    appsScriptUrl: "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL"
  };
  const state = {
    credential: "",
    profile: null,
    role: "",
    publicData: { members: [], announcements: [], minutes: [] },
    importRows: null
  };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const text = (value, fallback = "") => String(value == null || value === "" ? fallback : value);

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    initTheme();
    bindEvents();
    await loadPublicData();
    initGoogleSignIn();
    const savedCredential = sessionStorage.getItem("btb_google_credential");
    if (savedCredential) {
      state.credential = savedCredential;
      await loadMemberProfile();
    }
  }

  function initTheme() {
    const saved = localStorage.getItem("btb_theme");
    const theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    $("#theme-toggle").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("btb_theme", next);
    });
  }

  function bindEvents() {
    $("#menu-toggle").addEventListener("click", event => {
      const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
      event.currentTarget.setAttribute("aria-expanded", String(!expanded));
      $("#primary-nav").classList.toggle("open", !expanded);
    });
    $$("#primary-nav a").forEach(link => link.addEventListener("click", () => {
      $("#primary-nav").classList.remove("open");
      $("#menu-toggle").setAttribute("aria-expanded", "false");
    }));
    ["#hero-sign-in", "#dashboard-sign-in"].forEach(selector => $(selector).addEventListener("click", signIn));
    $("#directory-search").addEventListener("input", renderDirectory);
    $("#directory-filter").addEventListener("change", renderDirectory);
    $("#payment-form").addEventListener("submit", submitPayment);
    $("#print-card").addEventListener("click", () => window.print());
    $("#announcement-form").addEventListener("submit", publishAnnouncement);
    $("#minutes-form").addEventListener("submit", publishMinutes);
    $("#download-template").addEventListener("click", downloadMemberTemplate);
    $("#import-file").addEventListener("change", previewMemberImport);
    $("#import-confirm").addEventListener("click", importMembers);
    $("#approval-list").addEventListener("click", handleApproval);
    $("#admin-member-list").addEventListener("change", handleMemberChange);
    $("#admin-member-list").addEventListener("click", handleMemberStatus);
  }

  async function loadPublicData() {
    if (!CONFIG.publishedCsvUrl || CONFIG.publishedCsvUrl.includes("YOUR_PUBLISHED_SHEET_ID")) {
      $("#data-status").textContent = "Connect a published Google Sheet to load live band information.";
      $("#directory-notice").textContent = "Directory, announcements, and minutes are waiting for the published CSV URL.";
      renderPublicData();
      return;
    }
    $("#data-status").textContent = "Loading band updates…";
    try {
      const response = await fetch(CONFIG.publishedCsvUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`The sheet returned HTTP ${response.status}.`);
      const csv = await response.text();
      const result = Papa.parse(csv, { header: true, skipEmptyLines: "greedy", dynamicTyping: false });
      if (result.errors.length) console.warn("Some published CSV rows could not be parsed:", result.errors);
      state.publicData = groupPublicRows(result.data);
      $("#data-status").textContent = "Band updates are current.";
      try {
        localStorage.setItem("btb_public_data", JSON.stringify(state.publicData));
      } catch (cacheError) {
        console.warn("Could not cache public band data:", cacheError);
      }
      $("#directory-notice").textContent = result.errors.length
        ? "Some spreadsheet rows were skipped. Check the published sheet headers and values."
        : "";
    } catch (error) {
      try {
        const cached = localStorage.getItem("btb_public_data");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && Array.isArray(parsed.members) && Array.isArray(parsed.announcements) && Array.isArray(parsed.minutes)) {
            state.publicData = parsed;
          }
        }
      } catch (cacheError) {
        console.warn("Could not restore cached public band data:", cacheError);
      }
      const hasOfflineData = state.publicData.members.length + state.publicData.announcements.length + state.publicData.minutes.length > 0;
      $("#data-status").textContent = hasOfflineData
        ? "Offline — showing the last saved public updates."
        : "Live updates unavailable — check your connection.";
      $("#directory-notice").textContent = `${error.message} ${hasOfflineData ? "Showing cached public data." : "Check your connection and published CSV settings."}`;
      showToast("Could not load band updates. Please try again when you are online.");
    }
    renderPublicData();
  }

  function groupPublicRows(rows) {
    const grouped = { members: [], announcements: [], minutes: [] };
    rows.forEach(row => {
      const item = {};
      Object.keys(row).forEach(key => item[key.trim().toLowerCase().replace(/[\s-]+/g, "_")] = String(row[key] == null ? "" : row[key]).trim());
      const type = (item.record_type || item.type || "").toLowerCase();
      if (type === "member" || type === "directory") {
        grouped.members.push(item);
      } else if (type === "announcement" || type === "notification") {
        grouped.announcements.push(item);
      } else if (type === "minute" || type === "minutes") {
        grouped.minutes.push(item);
      }
    });
    return grouped;
  }

  function renderPublicData() {
    $("#member-count").textContent = String(state.publicData.members.length);
    renderDirectory();
    renderAnnouncements();
    renderMinutes();
  }

  function renderDirectory() {
    const query = $("#directory-search").value.trim().toLowerCase();
    const filter = $("#directory-filter").value;
    const members = state.publicData.members.filter(member => {
      const name = member.full_name || member.name || "";
      const role = member.role || member.instrument || "";
      const status = (member.status || "active").toLowerCase();
      return (!query || `${name} ${role}`.toLowerCase().includes(query)) &&
        (filter === "all" || status === filter);
    });
    const container = $("#directory-list");
    if (!members.length) {
      container.innerHTML = `<div class="empty-state card glass">${state.publicData.members.length ? "No members match your search." : "Member directory will appear here when the published CSV is connected."}</div>`;
      return;
    }
    container.innerHTML = members.map(member => {
      const name = member.full_name || member.name || "Band member";
      const role = member.role || member.instrument || "Member";
      const id = member.member_id || member.id || "";
      return `<article class="member-tile glass"><span class="avatar" aria-hidden="true">${escapeHtml(initials(name))}</span><div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(role)}</p></div><span class="member-meta">${escapeHtml(id)}</span></article>`;
    }).join("");
  }

  function renderAnnouncements() {
    const list = state.publicData.announcements;
    $("#announcement-list").innerHTML = list.length ? list.slice().reverse().map(item => {
      const title = item.title || "Band announcement";
      const message = item.message || item.summary || "";
      const priority = item.priority || "General";
      return `<article class="record-card"><div class="record-meta"><span>${escapeHtml(item.date || item.created_at || "Band update")}</span><span class="contribution-state ${priority.toLowerCase() === "urgent" ? "pending" : ""}">${escapeHtml(priority)}</span></div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></article>`;
    }).join("") : `<div class="empty-state card glass">Announcements will appear here when the public sheet is connected.</div>`;
  }

  function renderMinutes() {
    const list = state.publicData.minutes;
    $("#minutes-list").innerHTML = list.length ? list.slice().reverse().map(item => {
      const title = item.title || "Meeting minutes";
      const url = safeLink(item.drive_url || item.url || item.link);
      return `<article class="record-card"><div class="record-meta"><span>${escapeHtml(item.date || "Band records")}</span><span>Official notes</span></div><h3>${escapeHtml(title)}</h3>${url ? `<a class="record-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open meeting minutes ↗</a>` : `<p>Meeting notes link not provided.</p>`}</article>`;
    }).join("") : `<div class="empty-state card glass">Meeting minutes will appear here when the public sheet is connected.</div>`;
  }

  function initGoogleSignIn() {
    if (!CONFIG.googleClientId || CONFIG.googleClientId.includes("YOUR_")) {
      $("#auth-slot").innerHTML = `<button class="button button-primary" type="button" data-sign-in>Sign in</button>`;
      $("#auth-slot [data-sign-in]").addEventListener("click", () => showToast("Add your Google OAuth client ID in assets/js/app.js to enable sign-in."));
      return;
    }
    const ready = () => {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        window.setTimeout(ready, 150);
        return;
      }
      google.accounts.id.initialize({
        client_id: CONFIG.googleClientId,
        callback: credential => handleCredential(credential),
        auto_select: false,
        cancel_on_tap_outside: true
      });
      renderAuthSlot();
    };
    ready();
  }

  function signIn() {
    if (!CONFIG.googleClientId || CONFIG.googleClientId.includes("YOUR_")) {
      showToast("Add your Google OAuth client ID in assets/js/app.js to enable sign-in.");
      return;
    }
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.prompt();
    } else {
      showToast("Google sign-in is still loading. Please try again.");
    }
  }

  function renderAuthSlot() {
    const slot = $("#auth-slot");
    if (state.credential && state.profile && state.profile.member) {
      slot.innerHTML = `<span class="user-chip"><span>${escapeHtml(state.profile.member.full_name || state.profile.member.email)}</span></span><button class="button button-secondary" type="button" data-sign-out>Sign out</button>`;
      slot.querySelector("[data-sign-out]").addEventListener("click", signOut);
    } else {
      slot.innerHTML = `<button class="button button-primary" type="button" data-sign-in>Sign in</button>`;
      slot.querySelector("[data-sign-in]").addEventListener("click", signIn);
    }
  }

  async function handleCredential(response) {
    if (!response || !response.credential) {
      showToast("Google sign-in did not return a valid identity.");
      return;
    }
    state.credential = response.credential;
    sessionStorage.setItem("btb_google_credential", state.credential);
    await loadMemberProfile();
  }

  async function loadMemberProfile() {
    try {
      const result = await bridge("get_member_data");
      state.profile = result;
      state.role = result.role || "";
      if (!result.registered) {
        renderRegistrationForm();
        return;
      }
      renderAuthSlot();
      renderProfile();
      if (String(result.member.status).toLowerCase() === "active") {
        renderPayments(result.payments || []);
        await loadAdminData();
      }
    } catch (error) {
      signOut(false);
      showToast(error.message);
    }
  }

  function renderRegistrationForm() {
    $("#member-name").textContent = "Complete your member registration";
    $("#member-message").innerHTML = `<form id="registration-form" class="registration-form"><label>Full name<input name="fullName" required maxlength="100" autocomplete="name"></label><label>Phone number <span class="muted">(optional)</span><input name="phone" type="tel" maxlength="40" autocomplete="tel"></label><button class="button button-primary" type="submit">Request membership</button><p class="form-message" id="registration-message" role="status"></p></form>`;
    $("#member-status").textContent = "Not registered";
    $("#role-badge").textContent = "Guest";
    renderAuthSlot();
    $("#registration-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const message = $("#registration-message");
      try {
        await bridge("register_member", { fullName: form.get("fullName"), phone: form.get("phone") });
        message.textContent = "Request sent. A superadmin must approve your membership.";
        message.className = "form-message success";
        await loadMemberProfile();
      } catch (error) {
        message.textContent = error.message;
        message.className = "form-message error";
      }
    });
  }

  function renderProfile() {
    const member = state.profile.member;
    const status = text(member.status, "Pending");
    $("#member-name").textContent = `Hello, ${text(member.full_name, "member")}`;
    $("#member-message").textContent = status.toLowerCase() === "active"
      ? "Your band dashboard is ready. Here are the latest updates for you."
      : "Your membership request is awaiting approval. Private member tools will unlock once a superadmin activates your account.";
    $("#member-status").textContent = status;
    $("#member-status").className = `status-pill ${status.toLowerCase() === "active" ? "active" : ""}`;
    $("#role-badge").textContent = state.role || "General User";
    $("#contribution-status").textContent = status.toLowerCase() === "active" ? "No records yet" : "Membership pending";
    $("#contribution-caption").textContent = status.toLowerCase() === "active" ? "Your personal contribution history" : "Private financial records are locked";
    $("#id-member-name").textContent = text(member.full_name, "Band member");
    $("#id-member-role").textContent = state.role || "General User";
    $("#id-member-number").textContent = text(member.member_id, "—");
    $("#id-member-state").textContent = status;
    $("#print-card").disabled = status.toLowerCase() !== "active";
    if (status.toLowerCase() === "active" && window.QRCode) {
      const qr = $("#member-qr");
      qr.replaceChildren();
      new QRCode(qr, {
        text: text(member.member_id, member.email),
        width: 90,
        height: 90,
        colorDark: "#25204f",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    }
    $("#payment-form").querySelectorAll("input,button").forEach(control => control.disabled = status.toLowerCase() !== "active");
  }

  function renderPayments(payments) {
    const list = $("#payment-list");
    if (!payments.length) {
      list.innerHTML = `<p class="muted">No contribution records are attached to your account yet.</p>`;
      $("#contribution-status").textContent = "No records yet";
      return;
    }
    const pending = payments.filter(payment => String(payment.status).toLowerCase() === "pending").length;
    $("#contribution-status").textContent = pending ? `${pending} awaiting review` : "Up to date";
    list.innerHTML = payments.slice().reverse().map(payment => {
      const status = text(payment.status, "Pending");
      const receipt = safeLink(payment.receipt_url);
      return `<article class="record-card"><div class="record-meta"><span>${escapeHtml(payment.period || payment.submitted_at || "Contribution")}</span><span class="contribution-state ${status.toLowerCase()}">${escapeHtml(status)}</span></div><h3>${escapeHtml(payment.amount || "")}</h3><p>Reference: ${escapeHtml(payment.reference || "—")}</p>${receipt ? `<a class="record-link" href="${escapeHtml(receipt)}" target="_blank" rel="noopener noreferrer">View receipt ↗</a>` : ""}</article>`;
    }).join("");
  }

  async function loadAdminData() {
    const role = state.role.toLowerCase();
    const admin = role === "superadmin" || role === "admin";
    const finance = admin || role === "treasurer" || role === "financial secretary";
    const secretary = admin || role === "secretary";
    if (!admin && !finance && !secretary) return;
    $("#admin-tools").classList.remove("hidden");
    $("#admin-role").textContent = state.role;
    $("#approvals-panel").classList.toggle("hidden", !finance);
    $("#members-panel").classList.toggle("hidden", role !== "superadmin");
    $("#import-panel").classList.toggle("hidden", role !== "superadmin");
    $("#publish-panel").classList.toggle("hidden", !secretary);
    try {
      const result = await bridge("get_admin_data");
      renderApprovals(result.pendingPayments || []);
      if (Array.isArray(result.members)) renderAdminMembers(result.members);
    } catch (error) {
      showToast(`Could not load leadership data: ${error.message}`);
    }
  }

  function renderApprovals(payments) {
    $("#approval-list").innerHTML = payments.length ? payments.map(payment => `<article class="record-card"><div class="record-meta"><span>${escapeHtml(payment.period || "Contribution")}</span><span>${escapeHtml(payment.amount || "")}</span></div><h3>${escapeHtml(payment.email || payment.member_id || "Member")}</h3><p>Reference: ${escapeHtml(payment.reference || "—")}</p>${safeLink(payment.receipt_url) ? `<a class="record-link" href="${escapeHtml(safeLink(payment.receipt_url))}" target="_blank" rel="noopener noreferrer">Review receipt ↗</a>` : ""}<button class="mini-button" type="button" data-approve="${escapeHtml(payment.payment_id)}">Approve payment</button></article>`).join("") : `<p class="muted">No pending approvals.</p>`;
  }

  function renderAdminMembers(members) {
    const roles = ["General User", "Admin", "Secretary", "Treasurer", "Financial Secretary"];
    $("#admin-member-list").innerHTML = members.map(member => `<div class="admin-member-row"><div><strong>${escapeHtml(member.full_name || member.email)}</strong><small>${escapeHtml(member.email)} · ${escapeHtml(member.status)}</small></div><div class="row-actions"><select aria-label="Role for ${escapeHtml(member.full_name || member.email)}" data-member-role="${escapeHtml(member.member_id)}">${roles.map(role => `<option ${member.role === role ? "selected" : ""}>${escapeHtml(role)}</option>`).join("")}</select><button class="mini-button" type="button" data-member-status="${escapeHtml(member.member_id)}" data-next-status="${String(member.status).toLowerCase() === "active" ? "Suspended" : "Active"}">${String(member.status).toLowerCase() === "active" ? "Suspend" : "Approve"}</button></div></div>`).join("") || `<p class="muted">No member records found.</p>`;
  }

  async function handleApproval(event) {
    const button = event.target.closest("[data-approve]");
    if (!button) return;
    button.disabled = true;
    try {
      await bridge("approve_payment", { paymentId: button.dataset.approve });
      showToast("Payment approved.");
      await loadAdminData();
    } catch (error) {
      button.disabled = false;
      showToast(error.message);
    }
  }

  async function handleMemberChange(event) {
    const select = event.target.closest("[data-member-role]");
    if (!select) return;
    try {
      await bridge("set_member_role", { memberId: select.dataset.memberRole, role: select.value });
      showToast("Member role updated.");
    } catch (error) {
      showToast(error.message);
      await loadAdminData();
    }
  }

  async function handleMemberStatus(event) {
    const button = event.target.closest("[data-member-status]");
    if (!button) return;
    try {
      await bridge("set_member_status", { memberId: button.dataset.memberStatus, status: button.dataset.nextStatus });
      showToast(`Member status set to ${button.dataset.nextStatus}.`);
      await loadAdminData();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function submitPayment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const message = $("#payment-message");
    try {
      await bridge("submit_payment", values);
      message.textContent = "Payment reference submitted for review.";
      message.className = "form-message success";
      form.reset();
      await loadMemberProfile();
    } catch (error) {
      message.textContent = error.message;
      message.className = "form-message error";
    }
  }

  async function publishAnnouncement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#announcement-message");
    try {
      await bridge("add_announcement", Object.fromEntries(new FormData(form).entries()));
      message.textContent = "Announcement published.";
      message.className = "form-message success";
      form.reset();
    } catch (error) {
      message.textContent = error.message;
      message.className = "form-message error";
    }
  }

  async function publishMinutes(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#minutes-message");
    try {
      await bridge("add_minutes", Object.fromEntries(new FormData(form).entries()));
      message.textContent = "Meeting minutes link added.";
      message.className = "form-message success";
      form.reset();
    } catch (error) {
      message.textContent = error.message;
      message.className = "form-message error";
    }
  }

  async function previewMemberImport(event) {
    const file = event.target.files && event.target.files[0];
    state.importRows = null;
    $("#import-confirm").classList.add("hidden");
    $("#import-preview").textContent = "";
    if (!file) return;
    try {
      const result = await new Promise((resolve, reject) => Papa.parse(file, {
        header: true,
        skipEmptyLines: "greedy",
        dynamicTyping: false,
        complete: resolve,
        error: reject
      }));
      const rows = result.data;
      const required = ["full_name", "email", "phone", "role", "status"];
      const headers = (result.meta.fields || []).map(header => header.trim().toLowerCase());
      const missing = required.filter(header => !headers.includes(header));
      const errors = [];
      if (result.errors.length) errors.push(`${result.errors.length} CSV parsing error(s)`);
      if (missing.length) errors.push(`Missing columns: ${missing.join(", ")}`);
      if (rows.length > 200) errors.push("Maximum import size is 200 members.");
      if (!rows.length) errors.push("The CSV has no member rows.");
      const emails = new Set();
      rows.forEach((row, index) => {
        const email = String(row.email || "").trim().toLowerCase();
        if (!String(row.full_name || "").trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errors.push(`Row ${index + 2}: add a name and valid email.`);
        } else if (emails.has(email)) {
          errors.push(`Row ${index + 2}: duplicate email in this CSV.`);
        }
        emails.add(email);
      });
      if (errors.length) {
        $("#import-preview").innerHTML = `<p class="validation-error">${errors.map(escapeHtml).join("<br>")}</p>`;
        return;
      }
      state.importRows = rows;
      const previewRows = rows.slice(0, 5);
      $("#import-preview").innerHTML = `<p>${rows.length} rows validated. Preview:</p><table><thead><tr>${required.map(key => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead><tbody>${previewRows.map(row => `<tr>${required.map(key => `<td>${escapeHtml(row[key] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      $("#import-confirm").classList.remove("hidden");
    } catch (error) {
      $("#import-preview").innerHTML = `<p class="validation-error">Could not parse CSV: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function importMembers() {
    if (!state.importRows) return;
    const button = $("#import-confirm");
    button.disabled = true;
    try {
      const result = await bridge("bulk_import_members", { members: state.importRows });
      showToast(`${result.imported} member(s) imported.`);
      state.importRows = null;
      $("#import-file").value = "";
      $("#import-preview").textContent = "";
      button.classList.add("hidden");
      await loadAdminData();
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function downloadMemberTemplate() {
    const csv = "full_name,email,phone,role,status\r\nAda Okoro,ada@example.com,08001234567,General User,Pending\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "member_import_template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function bridge(action, payload = {}) {
    if (!state.credential) throw new Error("Sign in with Google to continue.");
    if (!CONFIG.appsScriptUrl || CONFIG.appsScriptUrl.includes("YOUR_")) {
      throw new Error("Add the deployed Apps Script web app URL in assets/js/app.js.");
    }
    const response = await fetch(CONFIG.appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, idToken: state.credential, ...payload })
    });
    if (!response.ok) throw new Error(`Apps Script returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "The request was not accepted.");
    return result.data;
  }

  function signOut(clearGoogle = true) {
    sessionStorage.removeItem("btb_google_credential");
    state.credential = "";
    state.profile = null;
    state.role = "";
    $("#admin-tools").classList.add("hidden");
    $("#member-name").textContent = "Your band community";
    $("#member-message").textContent = "Sign in with your Google account to view your member dashboard and contribution details.";
    $("#member-status").textContent = "Not signed in";
    $("#role-badge").textContent = "Guest";
    $("#contribution-status").textContent = "Sign in required";
    $("#contribution-caption").textContent = "Your records stay private";
    $("#payment-list").innerHTML = `<p class="muted">Sign in with an active member account to view private contribution records.</p>`;
    $("#payment-form").reset();
    $("#payment-form").querySelectorAll("input,button").forEach(control => control.disabled = false);
    $("#id-member-name").textContent = "Member name";
    $("#id-member-number").textContent = "Sign in to display";
    $("#id-member-state").textContent = "—";
    $("#id-member-role").textContent = "Registered member";
    $("#member-qr").replaceChildren();
    $("#print-card").disabled = true;
    renderAuthSlot();
    if (clearGoogle && window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  }

  function safeLink(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function initials(name) {
    return String(name).trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase() || "BT";
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    $("#toast-region").appendChild(toast);
    window.setTimeout(() => toast.remove(), 4800);
  }
})();
