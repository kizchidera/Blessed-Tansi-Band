# Blessed Tansi Band Group

A static, responsive member portal for GitHub Pages. Google Sheets stores the records, a deliberately limited published CSV supplies public directory/announcement/minutes data, Google Apps Script performs authenticated reads and writes, and Google Identity Services identifies members.

## Important privacy and security notes

- **Do not publish private membership or payment tabs as CSV.** A published CSV is public to anyone with its URL. Publish only a `PublicData` tab containing information the band has chosen to make public.
- Member roles, membership status, private contribution history, and payment approvals are checked again by Apps Script. Hiding controls in the browser is not authorization.
- Apps Script validates the Google ID token audience and verified email. Only emails in the `SUPERADMIN_EMAILS` script property can bootstrap or assign privileged roles. Keep the spreadsheet and script editor access restricted.
- Google Drive links are links, not uploads. Set the intended Drive sharing permissions before entering the link. Do not put sensitive receipts in a publicly shared folder.
- A GitHub Pages app is public source code. Never add OAuth client secrets, service-account keys, or passwords to this repository. A Google OAuth **client ID** is public by design.

## 1. Create the spreadsheet

Create a Google spreadsheet with these tabs and exact header rows. Keep IDs, phone numbers, and references formatted as **Plain text** in Sheets so leading zeros remain intact.

### `Members`

```text
member_id | full_name | email | phone | role | status | joined_at
```

### `Payments`

```text
payment_id | member_id | email | period | amount | reference | receipt_url | status | submitted_at | approved_by | approved_at
```

### `Announcements`

```text
announcement_id | title | message | priority | created_at | created_by
```

### `Minutes`

```text
minute_id | title | date | drive_url | uploaded_by
```

### `PublicData`

Make a separate public-safe tab with this header row:

```text
record_type | full_name | member_id | role | status | title | message | priority | date | drive_url
```

Use one row per public directory member (`record_type` = `member`), announcement (`announcement`), or meeting minutes link (`minutes`). Never add private email, phone, financial details, or receipt links to this tab.

## 2. Publish the public CSV

In Google Sheets, select **File → Share → Publish to web**, choose only the `PublicData` sheet, choose CSV, and publish. Copy the CSV URL. Publishing a tab makes that tab publicly readable; verify the selected tab and sample its URL in a private browser before using it.

Edit the `CONFIG` values at the top of [`assets/js/app.js`](./assets/js/app.js):

```js
googleClientId: "302392212120-ahsmq6b22a74h5538u4etkh8c3c5mpte.apps.googleusercontent.com",
publishedCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSyX3EAbrlffUM16wNh3PeHzhmU0zzt2RP3YpvKC1QXdcbN_CShBWtYR0evVGjyBDXqMx7ifGtGBgtS/pub?gid=0&single=true&output=csv",
appsScriptUrl: "https://script.google.com/macros/s/AKfycbyhgRzTQj2A9PXqGRsyIBUitoZiEt8F5kcFQx1Lc_FsOokrbhEno3vWE3uW9WCp4eoePA/exec"
```

Papa Parse is configured with `dynamicTyping: false`, so numeric-looking IDs and phone numbers remain strings. Keep the corresponding spreadsheet columns formatted as plain text too.

## 3. Configure Google sign-in

1. The OAuth consent screen is configured for **External** users in **Testing** mode. Add each permitted sign-in account under **Audience → Test users**; `blessedtansiband@gmail.com` has been added. Complete Google's verification/publishing requirements before allowing all members to sign in.
2. The **Web application** OAuth client has been created.
3. Its authorized JavaScript origins are `http://localhost:5500` and `https://kizchidera.github.io`.
4. The public OAuth client ID is configured in `assets/js/app.js`; never put a client secret in the frontend.
5. The Apps Script `SUPERADMIN_EMAILS` property is set to `blessedtansiband@gmail.com`. On first sign-in, the script creates an active starter member row for this account. The superadmin identity is configured server-side, not from a browser-supplied role.

## 4. Deploy the Apps Script bridge

1. Open **Extensions → Apps Script** from the spreadsheet.
2. The `google_apps_script.js` bridge has been added to the `BlessedTansi` Apps Script project and authorized as the spreadsheet owner.
3. Open **Project Settings → Script properties** and add:
   - `SPREADSHEET_ID`: the ID from the spreadsheet URL.
   - `GOOGLE_OAUTH_CLIENT_ID`: the same OAuth web client ID used by the app (already set).
   - `SUPERADMIN_EMAILS`: comma-separated email addresses of the initial superadmins.
4. The web app is deployed as **Me**, with access set to **Anyone**. Access to data and writes is checked by the script using each verified Google ID token and the sheet role. Do not rely on the deployment URL being secret.
5. The deployed `/exec` URL is configured in `assets/js/app.js`. After code changes, create a new deployment version.
6. Confirm the superadmin email is spelled correctly before inviting members. The initial account must appear in `SUPERADMIN_EMAILS`; role changes in the browser cannot create another superadmin.

The script requires all five tabs/headers above. `get_member_data` returns only the signed-in member's record and payments; finance executives receive pending payments; the complete private member list is exposed only to superadmins. Published CSV refreshes may be delayed briefly after spreadsheet changes.

## 5. Preview locally

Do not open `index.html` directly as a `file://` URL. From the project folder, start any local static server, for example:

```powershell
py -m http.server 5500
```

Then open `http://localhost:5500`. Alternatively, use the VS Code **Live Server** extension and add its origin to the Google OAuth client. Confirm the theme toggle, mobile navigation, public CSV data, Google sign-in, member registration, and authorized/unauthorized Apps Script actions.

Without configured Google URLs, the UI intentionally shows setup notices; the layout and theme still work.

## 6. Publish with GitHub Pages

1. Create or open the intended GitHub repository and place these files at its published root.
2. Review the files for private data and confirm only the `PublicData` tab is published.
3. In the repository, open **Settings → Pages**, choose **Deploy from a branch**, select the intended branch and `/ (root)`, then save.
4. Add the final Pages origin to the OAuth client's authorized origins. Wait for the deployment and open the Pages URL over HTTPS.
5. Verify the browser console/network and test account roles with separate member accounts.

For version control, review the changed files in VS Code Source Control, stage the intended app files, commit with a message such as `Build Blessed Tansi member portal`, then use **Publish Branch** / **Sync Changes** to push to the connected GitHub repository. The current workspace may need to be initialized as a Git repository and connected to the correct remote first; verify the repository and remote before pushing.

## Current feature scope

- Light/dark theme follows system preference and persists locally.
- Public directory, announcements, and minutes load from the published CSV.
- Google sign-in is matched to the private member directory; new sign-ins can request membership.
- Members can view their own contributions and submit payment references/receipt links.
- Verified finance roles can approve pending payments; superadmins manage member statuses and roles, bulk-import members, and secretaries/admins publish updates and minutes links.
- The member card generates a QR code from the member ID and can be printed/saved to PDF.
- CSV bulk onboarding validates a preview and downloads a matching template.

The portal does not store passwords, host receipt files, or provide general-purpose spreadsheet editing. Share any linked Drive files only with the intended audience.
