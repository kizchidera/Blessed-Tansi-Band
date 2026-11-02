const CONFIG = {
  spreadsheetId: PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID"),
  googleOAuthClientId: PropertiesService.getScriptProperties().getProperty("GOOGLE_OAUTH_CLIENT_ID"),
  superadminEmails: (PropertiesService.getScriptProperties().getProperty("SUPERADMIN_EMAILS") || "")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
};

const SHEETS = {
  members: "Members",
  payments: "Payments",
  announcements: "Announcements",
  minutes: "Minutes",
  publicData: "PublicData"
};

function doPost(event) {
  try {
    const body = JSON.parse(event.postData.contents || "{}");
    const user = authenticate_(body.idToken);
    const result = dispatch_(body.action, body, user);
    return json_({ ok: true, data: result });
  } catch (error) {
    return json_({ ok: false, error: error.message || "Request could not be completed." });
  }
}

function dispatch_(action, body, user) {
  switch (action) {
    case "register_member":
      return registerMember_(body, user);
    case "get_member_data":
      return getMemberData_(user);
    case "get_admin_data":
      return getAdminData_(user);
    case "submit_payment":
      return submitPayment_(body, user);
    case "approve_payment":
      return approvePayment_(body, user);
    case "set_member_role":
      return setMemberRole_(body, user);
    case "set_member_status":
      return setMemberStatus_(body, user);
    case "add_announcement":
      return addAnnouncement_(body, user);
    case "add_minutes":
      return addMinutes_(body, user);
    case "bulk_import_members":
      return bulkImportMembers_(body, user);
    default:
      throw new Error("Unsupported action.");
  }
}

function authenticate_(idToken) {
  if (!idToken || !CONFIG.googleOAuthClientId) {
    throw new Error("Google sign-in is not configured.");
  }

  const response = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error("Your Google sign-in has expired. Please sign in again.");
  }

  const identity = JSON.parse(response.getContentText());
  const email = String(identity.email || "").trim().toLowerCase();
  if (identity.aud !== CONFIG.googleOAuthClientId || identity.email_verified !== "true" || !email) {
    throw new Error("Google account verification failed.");
  }

  const member = findByValue_(SHEETS.members, "email", email);
  const isSuperadmin = CONFIG.superadminEmails.indexOf(email) !== -1;
  const isActive = member && String(member.status || "").toLowerCase() === "active";
  return {
    email: email,
    name: String(identity.name || ""),
    member: member,
    role: isSuperadmin ? "Superadmin" : (isActive ? String(member.role || "General User") : "General User"),
    isSuperadmin: isSuperadmin
  };
}

function registerMember_(body, user) {
  if (user.member) {
    throw new Error("This Google account is already registered.");
  }
  const name = clean_(body.fullName, 100);
  if (!name) {
    throw new Error("Enter your full name.");
  }

  const memberId = "BTB-" + Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase();
  append_(SHEETS.members, {
    member_id: memberId,
    full_name: name,
    email: user.email,
    phone: clean_(body.phone, 40),
    role: "General User",
    status: "Pending",
    joined_at: new Date().toISOString()
  });
  return { memberId: memberId, status: "Pending" };
}

function getMemberData_(user) {
  if (!user.member && user.isSuperadmin) {
    const memberId = "BTB-" + Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase();
    append_(SHEETS.members, {
      member_id: memberId,
      full_name: clean_(user.name, 100) || user.email,
      email: user.email,
      phone: "",
      role: "Admin",
      status: "Active",
      joined_at: new Date().toISOString()
    });
    user.member = findByValue_(SHEETS.members, "email", user.email);
  }
  if (!user.member) {
    return { registered: false, role: user.isSuperadmin ? "Superadmin" : "", member: null, payments: [] };
  }
  const member = user.member;
  const payments = rows_(SHEETS.payments).filter(row => String(row.email || "").toLowerCase() === user.email);
  return {
    registered: true,
    role: user.role,
    member: member,
    payments: payments
  };
}

function getAdminData_(user) {
  const data = {};
  if (user.isSuperadmin) {
    data.members = rows_(SHEETS.members);
  }
  if (canManagePayments_(user)) {
    data.pendingPayments = rows_(SHEETS.payments).filter(row => String(row.status || "").toLowerCase() === "pending");
  }
  return data;
}

function submitPayment_(body, user) {
  requireActiveMember_(user);
  const amount = Number(body.amount);
  const reference = clean_(body.reference, 120);
  const period = clean_(body.period, 80);
  if (!Number.isFinite(amount) || amount <= 0 || !reference || !period) {
    throw new Error("Enter a valid amount, contribution period, and payment reference.");
  }
  const paymentId = "PAY-" + Utilities.getUuid().replace(/-/g, "").slice(0, 12).toUpperCase();
  append_(SHEETS.payments, {
    payment_id: paymentId,
    member_id: user.member.member_id,
    email: user.email,
    period: period,
    amount: amount,
    reference: reference,
    receipt_url: safeUrl_(body.receiptUrl),
    status: "Pending",
    submitted_at: new Date().toISOString(),
    approved_by: "",
    approved_at: ""
  });
  return { paymentId: paymentId, status: "Pending" };
}

function approvePayment_(body, user) {
  if (!canManagePayments_(user)) {
    throw new Error("Your account is not permitted to approve payments.");
  }
  const paymentId = clean_(body.paymentId, 80);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error("Payment records are busy. Please try again.");
  }
  try {
    const sheet = sheet_(SHEETS.payments);
    const values = sheet.getDataRange().getDisplayValues();
    const columns = headerMap_(values[0] || []);
    const rowIndex = values.findIndex((row, index) => index > 0 && row[columns.payment_id] === paymentId);
    if (rowIndex < 1) {
      throw new Error("Payment record was not found.");
    }
    if (String(values[rowIndex][columns.status]).toLowerCase() !== "pending") {
      throw new Error("Only pending payments can be approved.");
    }
    sheet.getRange(rowIndex + 1, columns.status + 1).setValue("Approved");
    sheet.getRange(rowIndex + 1, columns.approved_by + 1).setValue(user.email);
    sheet.getRange(rowIndex + 1, columns.approved_at + 1).setValue(new Date().toISOString());
    return { paymentId: paymentId, status: "Approved" };
  } finally {
    lock.releaseLock();
  }
}

function setMemberRole_(body, user) {
  requireSuperadmin_(user);
  const allowed = ["General User", "Admin", "Secretary", "Treasurer", "Financial Secretary"];
  const role = clean_(body.role, 40);
  if (allowed.indexOf(role) === -1) {
    throw new Error("That role cannot be assigned.");
  }
  updateMember_(body.memberId, { role: role });
  return { memberId: clean_(body.memberId, 80), role: role };
}

function setMemberStatus_(body, user) {
  requireSuperadmin_(user);
  const status = clean_(body.status, 30);
  if (["Active", "Pending", "Suspended"].indexOf(status) === -1) {
    throw new Error("Choose Active, Pending, or Suspended.");
  }
  updateMember_(body.memberId, { status: status });
  return { memberId: clean_(body.memberId, 80), status: status };
}

function addAnnouncement_(body, user) {
  if (!user.isSuperadmin && ["Admin", "Secretary"].indexOf(user.role) === -1) {
    throw new Error("Your account is not permitted to publish announcements.");
  }
  const title = clean_(body.title, 120);
  const message = clean_(body.message, 2000);
  if (!title || !message) {
    throw new Error("Announcement title and message are required.");
  }
  const announcement = {
    announcement_id: "ANN-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
    title: title,
    message: message,
    priority: body.priority === "Urgent" ? "Urgent" : "General",
    created_at: new Date().toISOString(),
    created_by: user.email
  };
  append_(SHEETS.announcements, announcement);
  append_(SHEETS.publicData, {
    record_type: "announcement",
    full_name: "",
    member_id: "",
    role: "",
    status: "",
    title: title,
    message: message,
    priority: announcement.priority,
    date: announcement.created_at,
    drive_url: ""
  });
  return { published: true };
}

function addMinutes_(body, user) {
  if (!user.isSuperadmin && ["Admin", "Secretary"].indexOf(user.role) === -1) {
    throw new Error("Your account is not permitted to add meeting minutes.");
  }
  const title = clean_(body.title, 120);
  const driveUrl = safeUrl_(body.driveUrl);
  if (!title || !driveUrl || !/^https:\/\/drive\.google\.com(?:\/|$)/i.test(driveUrl)) {
    throw new Error("Provide a title and a valid Google Drive link.");
  }
  const date = clean_(body.date, 30) || new Date().toISOString().slice(0, 10);
  append_(SHEETS.minutes, {
    minute_id: "MIN-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
    title: title,
    date: date,
    drive_url: driveUrl,
    uploaded_by: user.email
  });
  append_(SHEETS.publicData, {
    record_type: "minutes",
    full_name: "",
    member_id: "",
    role: "",
    status: "",
    title: title,
    message: "",
    priority: "",
    date: date,
    drive_url: driveUrl
  });
  return { published: true };
}

function bulkImportMembers_(body, user) {
  requireSuperadmin_(user);
  const entries = body.members;
  if (!Array.isArray(entries) || !entries.length || entries.length > 200) {
    throw new Error("Choose a CSV with between 1 and 200 members.");
  }
  const existingEmails = new Set(rows_(SHEETS.members).map(row => String(row.email || "").toLowerCase()));
  const newRows = [];
  entries.forEach(entry => {
    const email = clean_(entry.email, 160).toLowerCase();
    const fullName = clean_(entry.full_name, 100);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || existingEmails.has(email)) {
      throw new Error("Import contains a missing name, invalid/duplicate email, or an existing member.");
    }
    existingEmails.add(email);
    const requestedRole = clean_(entry.role, 40);
    newRows.push({
      member_id: "BTB-" + Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase(),
      full_name: fullName,
      email: email,
      phone: clean_(entry.phone, 40),
      role: ["Secretary", "Treasurer", "Financial Secretary"].indexOf(requestedRole) !== -1
        ? requestedRole : "General User",
      status: clean_(entry.status, 30) === "Active" ? "Active" : "Pending",
      joined_at: new Date().toISOString()
    });
  });
  appendMany_(SHEETS.members, newRows);
  return { imported: newRows.length };
}

function updateMember_(memberId, updates) {
  const targetId = clean_(memberId, 80);
  if (!targetId) {
    throw new Error("Member ID is required.");
  }
  const sheet = sheet_(SHEETS.members);
  const values = sheet.getDataRange().getDisplayValues();
  const columns = headerMap_(values[0] || []);
  const rowIndex = values.findIndex((row, index) => index > 0 && row[columns.member_id] === targetId);
  if (rowIndex < 1) {
    throw new Error("Member record was not found.");
  }
  Object.keys(updates).forEach(key => sheet.getRange(rowIndex + 1, columns[key] + 1).setValue(updates[key]));
}

function canManagePayments_(user) {
  return user.isSuperadmin || ["Admin", "Treasurer", "Financial Secretary"].indexOf(user.role) !== -1;
}

function requireSuperadmin_(user) {
  if (!user.isSuperadmin) {
    throw new Error("Only a configured superadmin can perform this action.");
  }
}

function requireActiveMember_(user) {
  if (!user.member || String(user.member.status).toLowerCase() !== "active") {
    throw new Error("An active member account is required for this action.");
  }
}

function findByValue_(sheetName, key, value) {
  return rows_(sheetName).find(row => String(row[key] || "").trim().toLowerCase() === value) || null;
}

function rows_(sheetName) {
  const values = sheet_(sheetName).getDataRange().getDisplayValues();
  if (values.length < 2) {
    return [];
  }
  const headers = values[0].map(header => String(header).trim().toLowerCase());
  return values.slice(1).filter(row => row.some(cell => cell !== "")).map(row => {
    const item = {};
    headers.forEach((header, index) => item[header] = row[index] || "");
    return item;
  });
}

function append_(sheetName, record) {
  appendMany_(sheetName, [record]);
}

function appendMany_(sheetName, records) {
  const sheet = sheet_(sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = (values[0] || []).map(header => String(header).trim().toLowerCase());
  if (!headers.length || records.some(record => Object.keys(record).some(key => headers.indexOf(key) === -1))) {
    throw new Error("Sheet headers are missing or do not match the setup guide.");
  }
  const rows = records.map(record => headers.map(header => {
    const value = record[header] === undefined ? "" : record[header];
    return typeof value === "string" && /^[=+\-@]/.test(value) ? "'" + value : value;
  }));
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function sheet_(name) {
  if (!CONFIG.spreadsheetId) {
    throw new Error("Set the SPREADSHEET_ID script property.");
  }
  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    throw new Error("Required sheet tab is missing: " + name);
  }
  return sheet;
}

function headerMap_(headers) {
  const result = {};
  headers.forEach((header, index) => result[String(header).trim().toLowerCase()] = index);
  return result;
}

function clean_(value, maxLength) {
  return String(value || "").trim().replace(/[\u0000-\u001f]/g, "").slice(0, maxLength);
}

function safeUrl_(value) {
  const url = clean_(value, 500);
  if (!url) {
    return "";
  }
  if (!/^https:\/\/[^ ]+$/i.test(url)) {
    throw new Error("Links must use HTTPS.");
  }
  return url;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
