# Blessed Tansi Band Group

A static, responsive member portal built with HTML, CSS, vanilla JavaScript, and Supabase. It is designed to run on GitHub Pages; all authenticated database and file operations are made directly from the browser using the Supabase publishable (or legacy anon) key.

## Set up Supabase

1. Create a Supabase project and open **SQL Editor**.
2. Run [`supabase_schema.sql`](./supabase_schema.sql) once. It creates the tables, signup profile trigger, access-control helpers, RLS policies, storage buckets, and the historical payment import function.
3. In **Project Settings → API**, copy the Project URL and the publishable key (or legacy anon key). Add them to `SUPABASE_URL` and `SUPABASE_ANON_KEY` in [`assets/js/supabaseClient.js`](./assets/js/supabaseClient.js). Never use a `service_role` key in this application.
4. In **Authentication → URL Configuration**, set the site URL and allowed redirect URLs for local development and the GitHub Pages URL, for example `https://<account>.github.io/<repository>/`.
5. Serve the project over HTTP during development (the ES modules do not work from a `file://` URL), then publish the repository using GitHub Pages.
6. Create the first account through the app and confirm its email if email confirmation is enabled. In the SQL Editor, promote that account using its Auth user UUID:

   ```sql
   update public.profiles
   set role = 'superadmin', status = 'approved'
   where id = 'YOUR_AUTH_USER_UUID';
   ```

   Sign in again. The superadmin can approve member accounts, assign executive roles and permission flags, import records, and manage the landing page.

## Access and files

- New accounts are created as `user` / `pending`; a superadmin must approve them. Users cannot edit their own role, approval status, permission flags, member ID, or join date.
- Executive permissions are independently controlled by `can_upload_minutes`, `can_verify_payments`, `can_view_financials`, and `can_post_announcements`. Row-level policies and storage policies enforce these permissions regardless of the interface.
- Receipts and minutes are private files. Receipt uploads are stored under the member's Auth UUID; minutes are readable by approved members. Avatars and site branding use public buckets so they can be displayed on the directory and public landing page.
- Financial totals come from verified payment records and recalculate as soon as a treasurer verifies a submission. Amounts are displayed without assuming a currency; configure the currency convention with your organization.
- The member CSV template updates existing accounts by Auth UUID; it cannot create Auth users. Historical contribution imports use the database-guarded `import_historical_payment` function and are recorded as verified by the importing superadmin.
- PapaParse and the QR code generator are loaded from public CDNs. Keep internet access available for those features.

## Before launch

Review the Supabase project's Auth email settings, redirect URLs, backup/retention policy, and storage limits. The browser-visible key is expected to be public; the security boundary is the database schema, RLS policies, and storage policies. Do not disable RLS or add a service-role key to the site.
