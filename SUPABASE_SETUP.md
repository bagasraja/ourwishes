# Supabase setup for Our Wishes

Supabase stores accounts and wishlists online so a user can sign in on another device. Registration asks for a username and password only. The app turns the username into a private, non-deliverable identifier for Supabase Auth; users never enter an email address.

## 1. Create the database tables

Create a Supabase project. In **SQL Editor**, paste and run `supabase-schema.sql`. It creates the wishlist tables and row-level security policies. Keep RLS enabled.

## 2. Allow username-only accounts

In **Authentication → Providers → Email**, turn **Confirm email** off. Supabase must return a session immediately after signup because these accounts do not have a real email address to receive a confirmation link.

In **Authentication → URL Configuration**, set the Site URL to the Netlify site address, such as `https://your-site.netlify.app`. Add that address to the allowed redirect URLs. For local testing, allow `http://localhost:4173/**`.

Usernames are 3–24 characters and may contain letters, numbers, dots, underscores, or hyphens. Usernames are case-insensitive. Passwords must be at least 8 characters.

## 3. Configure the browser client

In **Project Settings → API**, copy the Project URL and the **publishable** key (or legacy `anon` key) into `supabase-config.js`:

```js
window.WISHES_SUPABASE = {
  url: "https://your-project-id.supabase.co",
  publishableKey: "your-public-publishable-key"
};
```

The publishable key is meant for browser code. Row-level security limits each authenticated user to their own wishlist data. This setup does not need a service-role key or a Netlify Function.

## 4. Deploy

Push the site to GitHub and import the repository in Netlify. It is a plain static site: use the repository root as the publish directory and leave the build command empty. Commit `supabase-config.js` with the URL and publishable key; Netlify will redeploy after the push.

## Important account limitation

Because signup does not collect email or phone, there is no email confirmation or password-reset route. Users must remember both their username and password. If they lose the password, the account cannot be recovered through this app. The internal `.invalid` address is only an Auth identifier and cannot receive mail.

Existing local-only accounts remain on the browser where they were created. They are not automatically transferred into username-only cloud accounts unless the usernames match a legacy account name exactly.

## Wishlist prices and photos

Prices are stored as whole Indonesian rupiah amounts. In the add-wish form, choose **— Belum tahu harganya** to save no amount; the card displays `—` instead of `Rp0`. Leave the image URL blank to choose a sample photo from words in the wish title or collection, such as `tas`, `rumah`, `sofa`, or `lampu`. A valid HTTPS image URL always takes priority.